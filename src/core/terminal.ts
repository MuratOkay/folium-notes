/** Turn a note line (or selection) into the text sent to the integrated terminal. */

export type TerminalLineReason = 'empty' | 'fence' | 'heading';

export interface TerminalLineResult {
  /** Text to send; undefined when the line should not be sent. */
  text?: string;
  reason?: TerminalLineReason;
}

const SHELL_PROMPT = /^(?:\$|PS>|>|❯|λ)\s+/;
const TASK_MARKER = /^[-*+]\s+\[[ xX]\]\s*/;
const BULLET_MARKER = /^[-*+]\s+/;
const ORDERED_MARKER = /^\d+[.)]\s+/;
const QUOTE_MARKER = /^>\s?/;
const INLINE_CODE = /^`([^`]+)`$/;

/**
 * Normalise one Markdown line into a terminal command.
 * Strips list/task/ordered markers, blockquotes and shell prompts, and refuses
 * headings, code fences and empty lines. Markdown emphasis is left untouched
 * (the terminal sees exactly what you typed minus the Markdown markers).
 */
export function terminalCommandFromLine(line: string): TerminalLineResult {
  let text = line.replace(/^\uFEFF/, '').replace(/\r$/, '').trim();
  if (!text) return { reason: 'empty' };
  if (/^(```|~~~)/.test(text)) return { reason: 'fence' };
  if (/^#{1,6}\s+/.test(text)) return { reason: 'heading' };
  const inline = INLINE_CODE.exec(text);
  if (inline) text = inline[1].trim();
  let previous = '';
  while (previous !== text) {
    previous = text;
    text = text
      .replace(TASK_MARKER, '')
      .replace(BULLET_MARKER, '')
      .replace(ORDERED_MARKER, '')
      .replace(QUOTE_MARKER, '')
      .replace(SHELL_PROMPT, '')
      .trim();
  }
  if (!text) return { reason: 'empty' };
  if (/^(```|~~~)/.test(text)) return { reason: 'fence' };
  const trailingInline = INLINE_CODE.exec(text);
  if (trailingInline) text = trailingInline[1].trim();
  return text ? { text } : { reason: 'empty' };
}

/** Normalise a multi-line selection: apply the line rules to each line, drop non-commands. */
export function terminalCommandFromSelection(selection: string): string | undefined {
  const commands: string[] = [];
  for (const line of selection.replace(/\r\n?/g, '\n').split('\n')) {
    const parsed = terminalCommandFromLine(line);
    if (parsed.text) commands.push(parsed.text);
  }
  const text = commands.join('\n').trim();
  return text.length > 0 ? text : undefined;
}

export interface ExtractedCommand {
  /** One-based line number inside the note body. */
  line: number;
  text: string;
}

const PROMPT_MARKER = /^\s*(?:[-*+]|\d+[.)])?\s*(?:\[[ xX]\]\s*)?\$\s+\S/;

/**
 * Commands of a note for the Commands view: every line inside a fenced code block plus explicit
 * `$ command` lines (list markers and task checkboxes allowed) outside fences. Prose is ignored.
 */
export function extractTerminalCommands(body: string): ExtractedCommand[] {
  const out: ExtractedCommand[] = [];
  let fence: string | undefined;
  const lines = body.replace(/\r\n?/g, '\n').split('\n');
  for (let index = 0; index < lines.length; index++) {
    const raw = lines[index];
    const trimmed = raw.trim();
    const fenceMatch = /^(```|~~~)/.exec(trimmed);
    if (fenceMatch) {
      if (fence === fenceMatch[1]) fence = undefined;
      else if (!fence) fence = fenceMatch[1];
      continue;
    }
    if (fence) {
      const parsed = terminalCommandFromLine(raw);
      if (parsed.text) out.push({ line: index + 1, text: parsed.text });
      continue;
    }
    if (!PROMPT_MARKER.test(raw)) continue;
    const parsed = terminalCommandFromLine(raw);
    if (parsed.text) out.push({ line: index + 1, text: parsed.text });
  }
  return out;
}
