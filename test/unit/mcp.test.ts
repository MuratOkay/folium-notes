import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { build } from 'esbuild';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

let bundle: string;
let privateRoot: string;
const children: ChildProcessWithoutNullStreams[] = [];

beforeAll(async () => {
  bundle = path.join(os.tmpdir(), `folium-mcp-${process.pid}.cjs`);
  privateRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'folium-mcp-root-'));
  await build({
    entryPoints: [path.resolve(__dirname, '../../src/mcp/server.ts')],
    outfile: bundle,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    logLevel: 'silent',
  });
});

afterAll(async () => {
  for (const child of children) child.kill();
  await fs.rm(privateRoot, { recursive: true, force: true });
  await fs.rm(bundle, { force: true });
});

function startServer(): ChildProcessWithoutNullStreams {
  const child = spawn(process.execPath, [bundle], {
    env: { ...process.env, FOLIUM_PRIVATE_ROOT: privateRoot, FOLIUM_PROJECT: 'github.com/org/repo' },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  children.push(child);
  return child;
}

function collect(child: ChildProcessWithoutNullStreams): {
  messages: Array<Record<string, unknown>>;
  waitFor: (count: number) => Promise<void>;
} {
  const messages: Array<Record<string, unknown>> = [];
  let buffer = '';
  child.stdout.on('data', (chunk: Buffer) => {
    buffer += chunk.toString('utf8');
    for (;;) {
      const newline = buffer.indexOf('\n');
      if (newline === -1) break;
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      if (line.trim()) messages.push(JSON.parse(line) as Record<string, unknown>);
    }
  });
  return {
    messages,
    waitFor: async (count: number) => {
      const timeout = Date.now() + 5000;
      while (messages.length < count) {
        if (Date.now() > timeout) throw new Error(`timeout waiting for ${count} messages`);
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    },
  };
}

describe('MCP server', () => {
  it('initializes, lists tools and queues a follow-up note', async () => {
    const child = startServer();
    const output = collect(child);
    const send = (message: unknown) => child.stdin.write(`${JSON.stringify(message)}\n`);
    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1' } } });
    send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    send({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'create_followup_note',
        arguments: { content: 'Should we cache? Option A: Redis. Option B: Postgres.', title: 'Cache question' },
      },
    });
    await output.waitFor(3);
    const init = output.messages[0] as { result: { serverInfo: { name: string } } };
    expect(init.result.serverInfo.name).toBe('folium-notes');
    const tools = output.messages[1] as { result: { tools: Array<{ name: string }> } };
    expect(tools.result.tools.map((tool) => tool.name)).toEqual(['create_followup_note']);
    const call = output.messages[2] as { result: { content: Array<{ text: string }> } };
    expect(call.result.content[0].text).toContain('queued');
    const inbox = path.join(privateRoot, '.inbox');
    const files = (await fs.readdir(inbox)).filter((file) => file.endsWith('.json'));
    expect(files).toHaveLength(1);
    const request = JSON.parse(await fs.readFile(path.join(inbox, files[0]), 'utf8'));
    expect(request.source).toBe('mcp');
    expect(request.project).toBe('github.com/org/repo');
    expect(request.content).toContain('Redis');
    expect(request.version).toBe(1);
  });

  it('supports Content-Length framing and reports unknown methods', async () => {
    const child = startServer();
    const output = collect(child);
    const body = JSON.stringify({ jsonrpc: '2.0', id: 9, method: 'ping' });
    child.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
    const unknown = JSON.stringify({ jsonrpc: '2.0', id: 10, method: 'nope' });
    child.stdin.write(`Content-Length: ${Buffer.byteLength(unknown)}\r\n\r\n${unknown}`);
    await output.waitFor(2);
    expect(output.messages[0]).toEqual({ jsonrpc: '2.0', id: 9, result: {} });
    expect((output.messages[1] as { error: { code: number } }).error.code).toBe(-32601);
  });

  it('rejects oversized content', async () => {
    const child = startServer();
    const output = collect(child);
    child.stdin.write(
      `${JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'create_followup_note', arguments: { content: 'x'.repeat(200_001) } },
      })}\n`,
    );
    await output.waitFor(1);
    const response = output.messages[0] as { error: { message: string } };
    expect(response.error.message).toContain('too large');
  });
});
