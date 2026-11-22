/** Built-in templates and placeholder rendering/validation. */

import { parseNote } from './frontmatter';
import type { Scope } from './state';
import { formatLocalIso } from './time';
import { boundedLevenshtein } from './text';

export interface TemplateDefinition {
  name: string;
  description?: string;
  scope?: Scope;
  privateOnly?: boolean;
  sharedOnly?: boolean;
  sensitive?: boolean;
  kind?: string;
  target?: string;
  tags?: string[];
  color?: string;
  body: string;
  builtin?: boolean;
  sourcePath?: string;
  /** Other front-matter fields copied into new notes. */
  extra?: Record<string, unknown>;
}

const BUG = `# {{title}}

## Symptoms

## Steps to reproduce

1. 

## Expected

## Actual

## Environment

- Branch: {{branch}}
- Reported: {{date}} {{time}}

## Investigation

## Fix

- [ ] Reproduce
- [ ] Root cause
- [ ] Fix
- [ ] Regression test
`;

const MEETING = `# {{title}}

Date: {{date}} {{time}}
Attendees: 

## Agenda

## Notes

## Decisions

## Action items

- [ ] 
`;

const DECISION = `# {{title}}

Date: {{date}}
Status: proposed

## Context

## Decision

## Consequences

## Alternatives considered
`;

const MANUAL_TEST = `# {{title}}

## Prerequisites

\`\`\`bash
# Install dependencies and build
npm install
npm run build
\`\`\`

## Steps

1. 

## Expected result

## Actual result
`;

const CREDENTIALS = `# {{title}}

| No | Name | Username | Password |
| -- | ---- | -------- | -------- |
| 1  |      |          |          |

> Sensitive: this note is never exported, published or sent to AI tools.
`;

const TIL = `# {{title}}

## What I learned

## Why it matters

## Example

{{cursor}}

## Links
`;

const CHECKLIST = `# {{title}}

- [ ] 
`;

const BRANCH = `# {{title}}

Branch: {{branch}}
Created: {{date}}

## Context

## Checklist

- [ ] 
`;

const AI_PROMPT = `# {{title}}

## Task

## Context

File: {{file}}
Language: {{language}}

\`\`\`{{language}}
{{selection}}
\`\`\`

## Constraints

{{cursor}}
`;

const OTHER = `# {{title}}

{{cursor}}
`;

/** Built-in templates (team > personal > built-in precedence by name). */
export const BUILTIN_TEMPLATES: TemplateDefinition[] = [
  {
    name: 'Bug investigation',
    description: 'Reproduce, isolate and fix a bug.',
    tags: ['bug'],
    body: BUG,
    builtin: true,
  },
  {
    name: 'Meeting notes',
    description: 'Agenda, notes, decisions and action items.',
    tags: ['meeting'],
    body: MEETING,
    builtin: true,
  },
  {
    name: 'Decision record',
    description: 'Context, decision and consequences.',
    tags: ['decision'],
    body: DECISION,
    builtin: true,
  },
  {
    name: 'Manual test prerequisites',
    description: 'Prerequisites with a bash block, then test steps.',
    tags: ['test'],
    body: MANUAL_TEST,
    builtin: true,
  },
  {
    name: 'Credentials',
    description: 'Private, sensitive credentials table (encrypted on create).',
    privateOnly: true,
    sensitive: true,
    tags: ['credentials'],
    body: CREDENTIALS,
    builtin: true,
  },
  {
    name: 'Today I learned',
    description: 'Capture a small learning.',
    tags: ['til'],
    body: TIL,
    builtin: true,
  },
  {
    name: 'Checklist',
    description: 'A simple checklist.',
    body: CHECKLIST,
    builtin: true,
  },
  {
    name: 'Branch note',
    description: 'Notes for the current git branch.',
    tags: ['branch'],
    body: BRANCH,
    builtin: true,
  },
  {
    name: 'AI prompt',
    description: 'A prompt with selection, file and language context.',
    sharedOnly: true,
    kind: 'prompt',
    tags: ['ai'],
    body: AI_PROMPT,
    builtin: true,
  },
  {
    name: 'Other',
    description: 'An empty note.',
    body: OTHER,
    builtin: true,
  },
];

/* ------------------------------------------------------------------------- */
/* Placeholders                                                              */
/* ------------------------------------------------------------------------- */

export const BASIC_PLACEHOLDERS = [
  'title',
  'date',
  'time',
  'datetime',
  'user',
  'project',
  'branch',
] as const;

export const PROMPT_PLACEHOLDERS = ['selection', 'file', 'language', 'clipboard'] as const;

export const ALL_PLACEHOLDERS = [...BASIC_PLACEHOLDERS, ...PROMPT_PLACEHOLDERS, 'cursor', 'ask'];

const PLACEHOLDER_RE = /\{\{\s*([^{}]*?)\s*\}\}/g;

export interface PlaceholderToken {
  /** Full token including braces. */
  full: string;
  /** Name, or `ask` for questions. */
  name: string;
  /** Ask question text (without options). */
  question?: string;
  options?: string[];
  start: number;
  end: number;
}

export function parsePlaceholders(text: string): PlaceholderToken[] {
  const tokens: PlaceholderToken[] = [];
  PLACEHOLDER_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = PLACEHOLDER_RE.exec(text)) !== null) {
    const inner = match[1].trim();
    if (!inner) continue;
    const colon = inner.indexOf(':');
    const head = (colon === -1 ? inner : inner.slice(0, colon)).trim().toLowerCase();
    const token: PlaceholderToken = {
      full: match[0],
      name: head,
      start: match.index,
      end: match.index + match[0].length,
    };
    if (head === 'ask') {
      const rest = colon === -1 ? '' : inner.slice(colon + 1);
      const parts = rest.split('|');
      token.question = (parts[0] ?? '').trim();
      const options = parts.slice(1).map((option) => option.trim()).filter(Boolean);
      if (options.length > 0) token.options = options;
    }
    tokens.push(token);
  }
  return tokens;
}

export interface TemplateProblem {
  message: string;
  start: number;
  end: number;
  severity: 'error' | 'warning';
  suggestion?: string;
}

/** Validate placeholders (unknown names, prompt-only usage, empty ask, cursor, options). */
export function validateTemplate(
  body: string,
  options: { kind?: string } = {},
): TemplateProblem[] {
  const problems: TemplateProblem[] = [];
  const tokens = parsePlaceholders(body);
  const known = new Set<string>([...ALL_PLACEHOLDERS]);
  let cursorCount = 0;
  for (const token of tokens) {
    if (!known.has(token.name)) {
      const suggestion = closestPlaceholder(token.name);
      problems.push({
        message: `Unknown placeholder {{${token.name}}}`,
        start: token.start,
        end: token.end,
        severity: 'error',
        suggestion: suggestion ? `Did you mean {{${suggestion}}}?` : undefined,
      });
      continue;
    }
    if ((PROMPT_PLACEHOLDERS as readonly string[]).includes(token.name) && options.kind !== 'prompt') {
      problems.push({
        message: `{{${token.name}}} is only available in prompt templates (kind: prompt)`,
        start: token.start,
        end: token.end,
        severity: 'warning',
      });
    }
    if (token.name === 'cursor') {
      cursorCount++;
      if (cursorCount > 1) {
        problems.push({
          message: 'Only one {{cursor}} placeholder is allowed',
          start: token.start,
          end: token.end,
          severity: 'error',
        });
      }
    }
    if (token.name === 'ask') {
      if (!token.question) {
        problems.push({
          message: 'Question is empty — use {{ask:Your question}}',
          start: token.start,
          end: token.end,
          severity: 'error',
        });
      }
      const options = token.options ?? [];
      if (options.length > 6) {
        problems.push({
          message: 'Too many options (maximum 6)',
          start: token.start,
          end: token.end,
          severity: 'warning',
        });
      }
      const seen = new Set<string>();
      for (const option of options) {
        if (!option) {
          problems.push({
            message: 'Empty option in {{ask:…}}',
            start: token.start,
            end: token.end,
            severity: 'error',
          });
          break;
        }
        if (seen.has(option.toLowerCase())) {
          problems.push({
            message: `Duplicate option "${option}"`,
            start: token.start,
            end: token.end,
            severity: 'warning',
          });
          break;
        }
        seen.add(option.toLowerCase());
      }
    }
  }
  return problems;
}

export function closestPlaceholder(name: string): string | undefined {
  const lower = name.toLowerCase();
  if (!lower) return undefined;
  let best: { name: string; distance: number } | undefined;
  for (const candidate of ALL_PLACEHOLDERS) {
    const distance = boundedLevenshtein(lower, candidate, 3);
    if (distance === undefined) continue;
    if (!best || distance < best.distance) best = { name: candidate, distance };
  }
  return best?.name;
}

export interface AskQuestion {
  question: string;
  options?: string[];
}

export interface TemplateContext {
  title?: string;
  now?: Date;
  user?: string;
  project?: string;
  branch?: string;
  selection?: string;
  file?: string;
  language?: string;
  clipboard?: string;
  /** Answers for `{{ask:…}}` prompts, keyed by question text. */
  answers?: Record<string, string>;
}

export interface RenderResult {
  text: string;
  /** Offset of the removed {{cursor}} in `text`. */
  cursorOffset?: number;
  /** Unanswered questions, in document order. */
  questions: AskQuestion[];
  /** Unknown placeholders that were left untouched. */
  unknown: string[];
}

const pad = (n: number): string => String(n).padStart(2, '0');

export function renderTemplate(body: string, context: TemplateContext = {}): RenderResult {
  const now = context.now ?? new Date();
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const values: Record<string, string> = {
    title: context.title ?? '',
    date,
    time,
    datetime: `${date} ${time}`,
    user: context.user ?? '',
    project: context.project ?? '',
    branch: context.branch ?? '',
    selection: context.selection ?? '',
    file: context.file ?? '',
    language: context.language ?? '',
    clipboard: context.clipboard ?? '',
    created: formatLocalIso(now),
  };
  const tokens = parsePlaceholders(body);
  const questions: AskQuestion[] = [];
  const unknown: string[] = [];
  let out = '';
  let cursor = 0;
  let cursorOffset: number | undefined;
  for (const token of tokens) {
    out += body.slice(cursor, token.start);
    cursor = token.end;
    if (token.name === 'cursor') {
      if (cursorOffset === undefined) cursorOffset = out.length;
      continue;
    }
    if (token.name === 'ask') {
      const question = token.question ?? '';
      const answer = question ? context.answers?.[question] : undefined;
      if (answer === undefined && question && !questions.some((q) => q.question === question)) {
        questions.push({ question, options: token.options });
      }
      out += answer ?? '';
      continue;
    }
    if (token.name in values) {
      out += values[token.name];
      continue;
    }
    unknown.push(token.name);
    out += token.full;
  }
  out += body.slice(cursor);
  return { text: out, cursorOffset, questions, unknown };
}

/** Context used by the template preview (stable sample values). */
export function sampleContext(overrides: Partial<TemplateContext> = {}): TemplateContext {
  return {
    title: 'Fix login redirect',
    now: new Date(2026, 10, 22, 14, 14, 5),
    user: 'Ada Lovelace',
    project: 'github.com/acme/webapp',
    branch: 'feature/login',
    selection: 'return redirect(url);',
    file: 'src/auth/login.ts',
    language: 'typescript',
    clipboard: 'Paste from clipboard',
    ...overrides,
  };
}

/** Parse a template Markdown file (`template:` front-matter map + body). */
export function parseTemplateFile(raw: string, sourcePath?: string): TemplateDefinition | undefined {
  const parsed = parseNote(raw);
  const meta = parsed.meta;
  const tplRaw = meta.template;
  const tpl =
    tplRaw && typeof tplRaw === 'object' && !Array.isArray(tplRaw)
      ? (tplRaw as Record<string, unknown>)
      : {};
  const name =
    (typeof tpl.name === 'string' && tpl.name.trim()) ||
    (meta.title && meta.title.trim()) ||
    (sourcePath ? sourcePath.split(/[\\/]/).pop()!.replace(/\.md$/i, '') : '');
  if (!name) return undefined;
  const scope = tpl.scope === 'private' || tpl.scope === 'shared' ? tpl.scope : undefined;
  const extra: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(meta)) {
    if (['template', 'title', 'tags', 'color', 'kind', 'target', 'id', 'created', 'updated'].includes(key)) {
      continue;
    }
    extra[key] = value;
  }
  return {
    name,
    description: typeof tpl.description === 'string' ? tpl.description : undefined,
    scope,
    privateOnly: tpl.privateOnly === true || tpl.privateOnly === 'true',
    sharedOnly: tpl.sharedOnly === true || tpl.sharedOnly === 'true',
    sensitive: meta.sensitive === true,
    kind: meta.kind,
    target: meta.target,
    tags: meta.tags.length > 0 ? [...meta.tags] : undefined,
    color: meta.color,
    body: parsed.body.replace(/^\n+/, ''),
    sourcePath,
    extra: Object.keys(extra).length > 0 ? extra : undefined,
  };
}

/** Serialise template metadata + body as a template file. */
export function templateFileContent(input: {
  name: string;
  description?: string;
  scope?: Scope;
  privateOnly?: boolean;
  sharedOnly?: boolean;
  sensitive?: boolean;
  kind?: string;
  target?: string;
  tags?: string[];
  color?: string;
  body: string;
}): string {
  const lines: string[] = ['---', 'template:'];
  lines.push(`  name: ${quoteScalar(input.name)}`);
  if (input.description) lines.push(`  description: ${quoteScalar(input.description)}`);
  if (input.scope) lines.push(`  scope: ${input.scope}`);
  if (input.privateOnly) lines.push('  privateOnly: true');
  if (input.sharedOnly) lines.push('  sharedOnly: true');
  if (input.tags?.length) lines.push(`tags: [ ${input.tags.join(', ')} ]`);
  if (input.color) lines.push(`color: ${input.color}`);
  if (input.kind) lines.push(`kind: ${input.kind}`);
  if (input.target) lines.push(`target: ${input.target}`);
  if (input.sensitive) lines.push('sensitive: true');
  lines.push('---', '', input.body.endsWith('\n') ? input.body : `${input.body}\n`);
  return lines.join('\n');
}

function quoteScalar(value: string): string {
  return /^[A-Za-z0-9][A-Za-z0-9 ._/@()+-]*$/.test(value) ? value : JSON.stringify(value);
}

/** Merge team > personal > built-in templates by lower-cased name. */
export function collectTemplates(
  team: TemplateDefinition[],
  personal: TemplateDefinition[],
): TemplateDefinition[] {
  const byName = new Map<string, TemplateDefinition>();
  for (const template of BUILTIN_TEMPLATES) byName.set(template.name.toLowerCase(), template);
  for (const template of personal) byName.set(template.name.toLowerCase(), template);
  for (const template of team) byName.set(template.name.toLowerCase(), template);
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export type DefaultTemplateChoice = { kind: 'blank' } | { kind: 'ask' } | { kind: 'template'; template: TemplateDefinition };

/** Resolve `FoliumNotes.defaultTemplate` ("" blank, "ask", or a template name). */
export function resolveDefaultTemplate(
  setting: string | undefined,
  templates: TemplateDefinition[],
): DefaultTemplateChoice {
  const value = (setting ?? '').trim();
  if (!value) return { kind: 'blank' };
  if (value.toLowerCase() === 'ask') return { kind: 'ask' };
  const found = templates.find((template) => template.name.toLowerCase() === value.toLowerCase());
  if (found) return { kind: 'template', template: found };
  return { kind: 'blank' };
}

/** Filter templates by scope rules for the target note scope. */
export function templatesForScope(
  templates: TemplateDefinition[],
  scope: Scope,
): TemplateDefinition[] {
  return templates.filter((template) => {
    if (template.privateOnly && scope !== 'private') return false;
    if (template.sharedOnly && scope !== 'shared') return false;
    if (template.scope && template.scope !== scope) return false;
    return true;
  });
}

/** Hover / completion documentation for a placeholder name. */
export function placeholderDoc(name: string): string | undefined {
  const docs: Record<string, string> = {
    title: 'Title of the new note (`{{title}}`).',
    date: 'Local date, `YYYY-MM-DD`.',
    time: 'Local time, `HH:mm`.',
    datetime: 'Local date and time, `YYYY-MM-DD HH:mm`.',
    user: '`git config user.name` of the repository.',
    project: 'Project key (for example `github.com/org/repo`).',
    branch: 'Current git branch.',
    cursor: 'Final cursor position in the new note.',
    ask: 'Asks you a question: `{{ask:Question}}` or `{{ask:Question|Option A|Option B}}`.',
    selection: 'Selected text in the last code editor (prompt templates only).',
    file: 'Relative path of the last code editor (prompt templates only).',
    language: 'Language id of the last code editor (prompt templates only).',
    clipboard: 'Current clipboard text (prompt templates only).',
  };
  return docs[name.toLowerCase()];
}
