/** Follow-up notes: turn an AI answer into questions/decisions and send answers back. */

import { parse as parseYaml } from 'yaml';
import { findSections, maskCode, splitLines } from './markdown';
import { normalizeWhitespace } from './text';

export interface FollowUpQuestion {
  question: string;
  options: string[];
  answer?: string;
}

export interface FollowUpData {
  questions: FollowUpQuestion[];
  decisions: string[];
  openItems: string[];
}

/** Hard cap for content arriving from AI tools (bytes). */
export const MAX_FOLLOWUP_BYTES = 200_000;

function pushUnique(list: string[], value: string): void {
  const text = normalizeWhitespace(value.replace(/^[-*+]\s+/, '').replace(/^\d+[.)]\s+/, ''));
  if (text && !list.includes(text)) list.push(text);
}

function bulletsOf(sectionBody: string): string[] {
  const out: string[] = [];
  for (const line of splitLines(maskCode(sectionBody))) {
    const match = /^\s*[-*+]\s+(.*)$/.exec(line.text);
    if (match) pushUnique(out, match[1]);
  }
  return out;
}

function questionFromYaml(value: unknown): FollowUpQuestion | undefined {
  if (typeof value === 'string') {
    const question = normalizeWhitespace(value);
    return question ? { question, options: [] } : undefined;
  }
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  const question = normalizeWhitespace(
    typeof record.question === 'string' ? record.question : typeof record.q === 'string' ? record.q : '',
  );
  if (!question) return undefined;
  const optionsRaw = Array.isArray(record.options) ? record.options : [];
  const options = optionsRaw
    .map((option) => (typeof option === 'string' ? normalizeWhitespace(option) : ''))
    .filter(Boolean);
  return { question, options };
}

/** Parse a `followup` YAML block from an AI answer. */
export function parseFollowUpBlock(source: string): FollowUpData | undefined {
  const match = /```followup\r?\n([\s\S]*?)```/i.exec(source);
  if (!match) return undefined;
  let parsed: unknown;
  try {
    parsed = parseYaml(match[1], { uniqueKeys: false, prettyErrors: false });
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== 'object') return undefined;
  const record = parsed as Record<string, unknown>;
  const questionsRaw = Array.isArray(record.questions) ? record.questions : [];
  const questions = questionsRaw.map(questionFromYaml).filter((q): q is FollowUpQuestion => !!q);
  const decisionsRaw = Array.isArray(record.decisions) ? record.decisions : [];
  const decisions = decisionsRaw
    .map((item) => (typeof item === 'string' ? normalizeWhitespace(item) : ''))
    .filter(Boolean);
  const openRaw = Array.isArray(record.openItems)
    ? record.openItems
    : Array.isArray(record.open)
      ? record.open
      : [];
  const openItems = openRaw
    .map((item) => (typeof item === 'string' ? normalizeWhitespace(item) : ''))
    .filter(Boolean);
  return { questions, decisions, openItems };
}

/** Parse questions, decisions and options out of a free-form AI answer. */
export function parseFollowUp(source: string): FollowUpData {
  const fromBlock = parseFollowUpBlock(source);
  const data: FollowUpData = fromBlock ?? { questions: [], decisions: [], openItems: [] };
  const masked = maskCode(source);
  for (const section of findSections(masked)) {
    const heading = section.heading.toLowerCase();
    if (/question|open question/.test(heading)) {
      for (const bullet of bulletsOf(section.body)) {
        if (!data.questions.some((q) => q.question === bullet)) {
          data.questions.push({ question: bullet, options: [] });
        }
      }
    } else if (/decision/.test(heading)) {
      for (const bullet of bulletsOf(section.body)) pushUnique(data.decisions, bullet);
    } else if (/open items|todo|next steps|follow[- ]?ups?/.test(heading)) {
      for (const bullet of bulletsOf(section.body)) pushUnique(data.openItems, bullet);
    }
  }
  // "Option A:" style choices attach to the most recent question.
  let current: FollowUpQuestion | undefined = data.questions[data.questions.length - 1];
  for (const line of splitLines(masked)) {
    const option = /^\s*(?:[-*+]\s+)?Option\s+([A-Z0-9]+)\s*:\s*(.+)$/i.exec(line.text);
    if (option) {
      const text = normalizeWhitespace(option[2]);
      if (current && text && !current.options.includes(text)) current.options.push(text);
      continue;
    }
    const question = /^\s*(?:[-*+]\s+)?(?:Q\d*[:.)]\s*)?(.{8,}?\?)\s*$/.exec(line.text);
    if (question) {
      const captured = normalizeWhitespace(question[1]);
      const sentences = captured.split(/(?<=[.!?])\s+/).filter(Boolean);
      const lastSentence = sentences[sentences.length - 1] ?? captured;
      const text = lastSentence.endsWith('?') ? lastSentence : captured;
      let entry = data.questions.find((q) => q.question === text);
      if (!entry) {
        entry = { question: text, options: [] };
        data.questions.push(entry);
      }
      current = entry;
    }
  }
  return data;
}

export function hasFollowUpContent(data: FollowUpData): boolean {
  return data.questions.length > 0 || data.decisions.length > 0 || data.openItems.length > 0;
}

/** Note title for a follow-up (first question, else a generic title). */
export function followUpTitle(data: FollowUpData, fallback = 'Follow-up'): string {
  const first = data.questions[0]?.question ?? data.decisions[0] ?? data.openItems[0];
  if (!first) return fallback;
  const short = first.length > 60 ? `${first.slice(0, 57)}…` : first;
  return `Follow-up: ${short}`;
}

/** Build the note body with `- Answer:` slots and `- [ ]` options. */
export function composeFollowUpBody(data: FollowUpData, title: string): string {
  const lines: string[] = [`# ${title}`, ''];
  if (data.questions.length > 0) {
    lines.push('## Questions', '');
    for (const question of data.questions) {
      lines.push(`- ${question.question}`, '  - Answer: ');
      for (const option of question.options) lines.push(`  - [ ] ${option}`);
      lines.push('');
    }
  }
  if (data.decisions.length > 0) {
    lines.push('## Decisions', '');
    for (const decision of data.decisions) lines.push(`- ${decision}`);
    lines.push('');
  }
  if (data.openItems.length > 0) {
    lines.push('## Open items', '');
    for (const item of data.openItems) lines.push(`- [ ] ${item}`);
    lines.push('');
  }
  return lines.join('\n');
}

/** Read answers, decisions and open items back out of a follow-up note. */
export function parseFollowUpNote(body: string): FollowUpData {
  const data: FollowUpData = { questions: [], decisions: [], openItems: [] };
  let section = '';
  let current: FollowUpQuestion | undefined;
  for (const line of splitLines(body)) {
    const heading = /^#{1,6}\s+(.*)$/.exec(line.text);
    if (heading) {
      section = heading[1].trim().toLowerCase();
      current = undefined;
      continue;
    }
    const answer = /^\s{2,}[-*+]\s+Answer:\s*(.*)$/i.exec(line.text);
    if (answer && current) {
      const value = normalizeWhitespace(answer[1]);
      if (value) current.answer = value;
      continue;
    }
    const option = /^\s{2,}[-*+]\s+\[([ xX])\]\s+(.*)$/.exec(line.text);
    if (option && current) {
      const text = normalizeWhitespace(option[2]);
      if (!current.options.includes(text)) current.options.push(text);
      if (option[1].toLowerCase() === 'x') {
        current.answer = current.answer ? `${current.answer}, ${text}` : text;
      }
      continue;
    }
    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line.text);
    if (!bullet) continue;
    const text = normalizeWhitespace(bullet[1]);
    if (!text) continue;
    if (section.startsWith('question')) {
      current = { question: text, options: [] };
      data.questions.push(current);
    } else if (section.startsWith('decision')) {
      pushUnique(data.decisions, text);
    } else if (section.startsWith('open')) {
      pushUnique(data.openItems, text.replace(/^\[[ xX]\]\s*/, ''));
    }
  }
  return data;
}

/** Compose the reply for the AI conversation (answers, decisions, open items). */
export function composeAnswersReply(noteBody: string): string {
  const data = parseFollowUpNote(noteBody);
  const lines: string[] = [];
  const answers = data.questions.filter((question) => question.answer);
  if (answers.length > 0) {
    lines.push('Answers:', '');
    for (const question of answers) lines.push(`- ${question.question} → ${question.answer}`);
    lines.push('');
  }
  if (data.decisions.length > 0) {
    lines.push('Decisions:', '');
    for (const decision of data.decisions) lines.push(`- ${decision}`);
    lines.push('');
  }
  if (data.openItems.length > 0) {
    lines.push('Open items:', '');
    for (const item of data.openItems) lines.push(`- ${item}`);
    lines.push('');
  }
  return lines.join('\n').trim() + '\n';
}

/** JSON request written by AI tools into `<privateRoot>/.inbox`. */
export interface FollowUpRequest {
  version: 1;
  source: string;
  content: string;
  title?: string;
  created?: string;
  project?: string;
}

export function parseFollowUpRequest(json: string): FollowUpRequest {
  const parsed = JSON.parse(json) as Partial<FollowUpRequest>;
  const content = typeof parsed.content === 'string' ? parsed.content : '';
  if (!content.trim()) throw new Error('Follow-up request has no content');
  if (Buffer.byteLength(content, 'utf8') > MAX_FOLLOWUP_BYTES) {
    throw new Error('Follow-up content is too large');
  }
  return {
    version: 1,
    source: typeof parsed.source === 'string' ? parsed.source : 'unknown',
    content,
    title: typeof parsed.title === 'string' ? parsed.title : undefined,
    created: typeof parsed.created === 'string' ? parsed.created : undefined,
    project: typeof parsed.project === 'string' ? parsed.project : undefined,
  };
}
