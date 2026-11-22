/** Joplin Data API client (local desktop API) and note payload helpers. */

export interface JoplinOptions {
  url: string;
  token?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export interface JoplinNotebook {
  id: string;
  title: string;
}

export interface JoplinNoteInput {
  title: string;
  body: string;
  sourceUrl?: string;
}

export class JoplinError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'JoplinError';
  }
}

function normalizeUrl(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, '');
  if (!trimmed) return 'http://localhost:41184';
  return /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
}

export class JoplinApi {
  private readonly base: string;
  private readonly token?: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: JoplinOptions) {
    this.base = normalizeUrl(options.url);
    this.token = options.token?.trim() || undefined;
    this.timeoutMs = options.timeoutMs ?? 8000;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const separator = path.includes('?') ? '&' : '?';
    const url = this.token
      ? `${this.base}${path}${separator}token=${encodeURIComponent(this.token)}`
      : `${this.base}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(url, {
        ...init,
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
      });
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new JoplinError(
          `Joplin API ${response.status}${text ? `: ${text.slice(0, 200)}` : ''}`,
          response.status,
        );
      }
      return (await response.json()) as T;
    } catch (error) {
      if (error instanceof JoplinError) throw error;
      throw new JoplinError(
        `Cannot reach Joplin at ${this.base}: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  async ping(): Promise<boolean> {
    try {
      const result = await this.request<{ status?: string }>('/ping');
      return result?.status === 'ok';
    } catch {
      return false;
    }
  }

  async listNotebooks(): Promise<JoplinNotebook[]> {
    const result = await this.request<{ items?: JoplinNotebook[] }>('/folders?fields=id,title&limit=100');
    return result.items ?? [];
  }

  /** Find a notebook by title or create it. */
  async ensureNotebook(title: string): Promise<string> {
    const notebooks = await this.listNotebooks();
    const existing = notebooks.find((notebook) => notebook.title === title);
    if (existing) return existing.id;
    const created = await this.request<{ id: string }>('/folders', {
      method: 'POST',
      body: JSON.stringify({ title }),
    });
    return created.id;
  }

  async createNote(input: JoplinNoteInput & { parentId: string }): Promise<string> {
    const body: Record<string, unknown> = {
      title: input.title,
      body: input.body,
      parent_id: input.parentId,
      markdown: 1,
    };
    if (input.sourceUrl) body.source_url = input.sourceUrl;
    const created = await this.request<{ id: string }>('/notes', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    return created.id;
  }

  async updateNote(id: string, input: JoplinNoteInput): Promise<void> {
    const body: Record<string, unknown> = { title: input.title, body: input.body };
    if (input.sourceUrl) body.source_url = input.sourceUrl;
    await this.request(`/notes/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    });
  }
}

/** Body sent to Joplin: Markdown without the Folium header. */
export function joplinMarkdown(body: string): string {
  return body.replace(/\r\n/g, '\n').trimEnd() + '\n';
}
