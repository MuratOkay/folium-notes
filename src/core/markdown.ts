/** Markdown scanning helpers shared by tags, tasks, follow-ups and headings. */

export interface Range {
  start: number;
  end: number;
}

export interface LineInfo {
  text: string;
  start: number;
  end: number;
  number: number;
}

export function splitLines(text: string): LineInfo[] {
  const lines: LineInfo[] = [];
  let start = 0;
  let number = 1;
  while (start <= text.length) {
    const newline = text.indexOf('\n', start);
    const end = newline === -1 ? text.length : newline;
    let lineText = text.slice(start, end);
    if (lineText.endsWith('\r')) lineText = lineText.slice(0, -1);
    lines.push({ text: lineText, start, end, number });
    number++;
    if (newline === -1) break;
    start = newline + 1;
  }
  return lines;
}

export interface CodeBlock extends Range {
  /** Fence info string (without backticks), if fenced. */
  info: string;
  /** True for ``` / ~~~ fenced blocks, false for inline code spans. */
  fenced: boolean;
}

/** Find fenced code blocks (``` / ~~~) in a Markdown document. */
export function findFencedCodeBlocks(text: string): CodeBlock[] {
  const blocks: CodeBlock[] = [];
  const lines = splitLines(text);
  let open: { char: string; length: number; start: number; info: string } | undefined;
  for (const line of lines) {
    const fence = /^(\s{0,3})(`{3,}|~{3,})(.*)$/.exec(line.text);
    if (!open) {
      if (fence) {
        open = {
          char: fence[2][0],
          length: fence[2].length,
          start: line.start,
          info: fence[3].trim(),
        };
      }
      continue;
    }
    if (fence && fence[2][0] === open.char && fence[2].length >= open.length) {
      blocks.push({ start: open.start, end: line.end, info: open.info, fenced: true });
      open = undefined;
    }
  }
  if (open) {
    blocks.push({ start: open.start, end: text.length, info: open.info, fenced: true });
  }
  return blocks;
}

/** Find inline code spans (`code`, ``code``) in a Markdown document. */
export function findInlineCodeSpans(text: string): CodeBlock[] {
  const spans: CodeBlock[] = [];
  let index = 0;
  while (index < text.length) {
    const start = text.indexOf('`', index);
    if (start === -1) break;
    let run = 1;
    while (text[start + run] === '`') run++;
    const newlineBefore = text.lastIndexOf('\n', start);
    const atLineStart = text.slice(newlineBefore + 1, start).trim() === '';
    if (atLineStart && run >= 3) {
      index = start + run;
      continue;
    }
    const closing = text.indexOf('`'.repeat(run), start + run);
    if (closing === -1) break;
    spans.push({ start, end: closing + run, info: '', fenced: false });
    index = closing + run;
  }
  return spans;
}

export function findCodeRanges(text: string): CodeBlock[] {
  return [...findFencedCodeBlocks(text), ...findInlineCodeSpans(text)].sort(
    (a, b) => a.start - b.start,
  );
}

export function inRanges(position: number, ranges: Range[]): boolean {
  for (const range of ranges) {
    if (position >= range.start && position < range.end) return true;
  }
  return false;
}

/** Blank out fenced code blocks and inline code spans (offsets stay valid). */
export function maskCode(text: string): string {
  const ranges = findCodeRanges(text);
  if (ranges.length === 0) return text;
  const chars = text.split('');
  for (const range of ranges) {
    for (let i = range.start; i < range.end; i++) {
      if (chars[i] !== '\n') chars[i] = ' ';
    }
  }
  return chars.join('');
}
export interface FrontMatterSplit {
  /** Raw YAML text between the fences (empty when there is no header). */
  header: string;
  /** Offset in the original document where the header YAML starts. */
  headerStart: number;
  /** Offset where the header YAML ends (start of the closing fence). */
  headerEnd: number;
  /** Offset where the body starts. */
  bodyStart: number;
  /** Document with the header removed (body). */
  body: string;
  hasHeader: boolean;
  /** True when the document starts with a UTF-8 BOM. */
  bom: boolean;
  /** Line terminator used by the header fences. */
  eol: '\n' | '\r\n';
}

const OPEN_FENCE = /^(?:\uFEFF)?---[ \t]*(?:\r?\n)/;

/** Split a Markdown document into YAML front matter and body without parsing YAML. */
export function splitFrontMatter(raw: string): FrontMatterSplit {
  const bom = raw.startsWith('\uFEFF');
  const text = bom ? raw.slice(1) : raw;
  const shift = bom ? 1 : 0;
  const empty: FrontMatterSplit = {
    header: '',
    headerStart: 0,
    headerEnd: 0,
    bodyStart: raw.length,
    body: '',
    hasHeader: false,
    bom,
    eol: '\n',
  };
  const open = OPEN_FENCE.exec(text);
  if (!open) return { ...empty, bodyStart: shift, body: text };
  const headerStart = open[0].length;
  const rest = text.slice(headerStart);
  const closeMatch = /^(?:---|\.\.\.)[ \t]*$/m.exec(rest);
  if (!closeMatch) return { ...empty, bodyStart: shift, body: text };
  const headerEnd = headerStart + closeMatch.index;
  const closingLineEnd = rest.indexOf('\n', closeMatch.index);
  const bodyStart = closingLineEnd === -1 ? text.length : headerStart + closingLineEnd + 1;
  const eol: '\n' | '\r\n' = open[0].includes('\r\n') ? '\r\n' : '\n';
  return {
    header: text.slice(headerStart, headerEnd),
    headerStart: headerStart + shift,
    headerEnd: headerEnd + shift,
    bodyStart: bodyStart + shift,
    body: text.slice(bodyStart),
    hasHeader: true,
    bom,
    eol,
  };
}

/** First non-empty line without leading `#` marks — the title fallback. */
export function firstHeadingLine(
  body: string,
): { title: string; line: number; text: string; start: number } | undefined {
  const lines = splitLines(body);
  for (const line of lines) {
    const trimmed = line.text.trim();
    if (!trimmed) continue;
    return {
      title: trimmed.replace(/^#{1,6}\s*/, '').trim(),
      line: line.number,
      text: line.text,
      start: line.start,
    };
  }
  return undefined;
}

/** A heading section of a Markdown body (used by follow-up parsing). */
export interface Section {
  heading: string;
  level: number;
  start: number;
  end: number;
  body: string;
}

export function findSections(body: string): Section[] {
  const lines = splitLines(body);
  const sections: Section[] = [];
  let current: Section | undefined;
  for (const line of lines) {
    const m = /^(#{1,6})\s+(.*)$/.exec(line.text);
    if (m) {
      if (current) {
        current.end = line.start;
        current.body = body.slice(current.start, current.end);
        sections.push(current);
      }
      current = {
        heading: m[2].trim(),
        level: m[1].length,
        start: line.end + 1,
        end: body.length,
        body: '',
      };
    }
  }
  if (current) {
    current.body = body.slice(current.start, body.length);
    sections.push(current);
  }
  return sections;
}
