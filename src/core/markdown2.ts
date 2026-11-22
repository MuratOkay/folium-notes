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

interface MarkdownLine {
  text: string;
  number: number;
  start: number;
  /** Index of the final character in the line ending, or final text character. */
  end: number;
}

function splitLines(value: string): MarkdownLine[] {
  const lines: MarkdownLine[] = [];
  let start = 0;
  let number = 1;

  for (let i = 0; i < value.length; i++) {
    if (value[i] !== '\n' && value[i] !== '\r') continue;
    const isCrLf = value[i] === '\r' && value[i + 1] === '\n';
    const lineEnd = i;
    lines.push({
      text: value.slice(start, lineEnd),
      number,
      start,
      end: isCrLf ? i + 1 : i,
    });
    if (isCrLf) i++;
    start = i + 1;
    number++;
  }

  if (start < value.length) {
    lines.push({
      text: value.slice(start),
      number,
      start,
      end: value.length - 1,
    });
  }
  return lines;
}

/** Split a Markdown document into YAML front matter and body without parsing YAML. */
export function splitFrontMatter(raw: string): FrontMatterSplit {
  const bom = raw.startsWith('\uFEFF');
  const text = bom ? raw.slice(1) : raw;
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
  if (!open) return { ...empty, bodyStart: 0, body: text };
  const headerStart = open[0].length;
  const rest = text.slice(headerStart);
  const closeMatch = /^(?:---|\.\.\.)[ \t]*$/m.exec(rest);
  if (!closeMatch) return { ...empty, bodyStart: 0, body: text };
  const headerEnd = headerStart + closeMatch.index;
  const closingLineEnd = rest.indexOf('\n', closeMatch.index);
  const bodyStart = closingLineEnd === -1 ? text.length : headerStart + closingLineEnd + 1;
  const eol: '\n' | '\r\n' = open[0].includes('\r\n') ? '\r\n' : '\n';
  return {
    header: text.slice(headerStart, headerEnd),
    headerStart,
    headerEnd,
    bodyStart,
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
