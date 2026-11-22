/** Standalone stdio MCP server: `create_followup_note` writes into <privateRoot>/.inbox. */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

const SERVER_NAME = 'folium-notes';
const SERVER_VERSION = '0.1.0';
const MAX_CONTENT_BYTES = 200_000;
const PROTOCOL_VERSION = '2024-11-05';

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: number | string | null;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number | string | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

function privateRoot(): string {
  const configured = process.env.FOLIUM_PRIVATE_ROOT?.trim();
  if (!configured) return path.join(os.homedir(), 'FoliumNotes');
  if (configured === '~' || configured.startsWith('~/') || configured.startsWith('~\\')) {
    return path.join(os.homedir(), configured.slice(2));
  }
  return configured;
}

async function writeInboxRequest(content: string, title?: string, project?: string): Promise<string> {
  const bytes = Buffer.byteLength(content, 'utf8');
  if (bytes === 0) throw new Error('content is required');
  if (bytes > MAX_CONTENT_BYTES) throw new Error('content is too large');
  const inbox = path.join(privateRoot(), '.inbox');
  await fs.mkdir(inbox, { recursive: true });
  const id = randomUUID();
  const payload = {
    version: 1,
    source: 'mcp',
    content,
    title,
    project: project ?? process.env.FOLIUM_PROJECT ?? '',
    created: new Date().toISOString(),
    requestId: id,
    digest: createHash('sha256').update(content).digest('hex').slice(0, 16),
  };
  const temp = path.join(inbox, `.${id}.json.tmp`);
  const target = path.join(inbox, `${Date.now()}-${id}.json`);
  await fs.writeFile(temp, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  await fs.rename(temp, target);
  return target;
}

const TOOLS = [
  {
    name: 'create_followup_note',
    description:
      'Create a Folium Notes follow-up note from an AI answer. Questions, decisions and open items become a shared note. Private and sensitive notes are never included.',
    inputSchema: {
      type: 'object',
      properties: {
        content: {
          type: 'string',
          description: 'The AI answer to extract follow-up questions and decisions from.',
        },
        title: { type: 'string', description: 'Optional title for the follow-up note.' },
        project: { type: 'string', description: 'Optional project key (e.g. github.com/org/repo).' },
      },
      required: ['content'],
      additionalProperties: false,
    },
  },
];

async function callTool(params: Record<string, unknown> | undefined): Promise<unknown> {
  const name = typeof params?.name === 'string' ? params.name : '';
  if (name !== 'create_followup_note') {
    throw new Error(`Unknown tool: ${name}`);
  }
  const args = (params?.arguments ?? {}) as { content?: unknown; title?: unknown; project?: unknown };
  if (typeof args.content !== 'string') throw new Error('content must be a string');
  const file = await writeInboxRequest(
    args.content,
    typeof args.title === 'string' ? args.title : undefined,
    typeof args.project === 'string' ? args.project : undefined,
  );
  return {
    content: [
      {
        type: 'text',
        text: `Follow-up note request queued for Folium Notes (${path.basename(file)}). The open IDE creates the note.`,
      },
    ],
    isError: false,
  };
}

async function handle(request: JsonRpcRequest): Promise<JsonRpcResponse | undefined> {
  if (request.id === undefined) return undefined;
  const id = request.id ?? null;
  try {
    switch (request.method) {
      case 'initialize':
        return {
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: PROTOCOL_VERSION,
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
            instructions:
              'Folium Notes. Use create_followup_note with an AI answer to turn questions and decisions into a shared note. You cannot read notes.',
          },
        };
      case 'ping':
        return { jsonrpc: '2.0', id, result: {} };
      case 'tools/list':
        return { jsonrpc: '2.0', id, result: { tools: TOOLS } };
      case 'tools/call':
        return { jsonrpc: '2.0', id, result: await callTool(request.params) };
      default:
        return {
          jsonrpc: '2.0',
          id,
          error: { code: -32601, message: `Method not found: ${request.method}` },
        };
    }
  } catch (error) {
    return {
      jsonrpc: '2.0',
      id,
      error: { code: -32603, message: error instanceof Error ? error.message : String(error) },
    };
  }
}

function writeMessage(message: JsonRpcResponse): void {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

/** Framing: newline-delimited JSON (MCP stdio) and Content-Length headers. */
class Reader {
  private buffer = '';

  constructor(private readonly onRequest: (request: JsonRpcRequest) => void) {}

  push(chunk: string): void {
    this.buffer += chunk;
    for (;;) {
      if (this.buffer.startsWith('Content-Length:')) {
        const headerEnd = this.buffer.indexOf('\r\n\r\n');
        if (headerEnd === -1) return;
        const header = this.buffer.slice(0, headerEnd);
        const length = Number(/Content-Length:\s*(\d+)/i.exec(header)?.[1] ?? 0);
        const bodyStart = headerEnd + 4;
        if (this.buffer.length < bodyStart + length) return;
        const body = this.buffer.slice(bodyStart, bodyStart + length);
        this.buffer = this.buffer.slice(bodyStart + length);
        this.dispatch(body);
        continue;
      }
      const newline = this.buffer.indexOf('\n');
      if (newline === -1) return;
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (line) this.dispatch(line);
    }
  }

  private dispatch(body: string): void {
    let parsed: JsonRpcRequest;
    try {
      parsed = JSON.parse(body) as JsonRpcRequest;
    } catch {
      writeMessage({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
      return;
    }
    if (!parsed || typeof parsed.method !== 'string') return;
    this.onRequest(parsed);
  }
}

const reader = new Reader((request) => {
  void handle(request).then((response) => {
    if (response) writeMessage(response);
  });
});

process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk: string) => reader.push(chunk));
process.stdin.on('error', () => process.exit(0));
process.stdin.resume();
process.on('SIGTERM', () => process.exit(0));
