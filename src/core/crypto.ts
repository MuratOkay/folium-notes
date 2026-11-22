/** AES-256-GCM note encryption. Keys live in IDE secret storage as base64 text. */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { parseNote, serializeNote, setFrontMatterFields } from './frontmatter';
import { firstHeadingLine, splitFrontMatter } from './markdown';

export const KEY_BYTES = 32;
export const IV_BYTES = 12;
export const TAG_BYTES = 16;
export const ENCRYPTED_FENCE = 'Folium-encrypted';
export const ALGORITHM = 'aes-256-gcm';

export function generateKey(): Buffer {
  return randomBytes(KEY_BYTES);
}

export function keyToText(key: Buffer): string {
  return key.toString('base64');
}

export function keyFromText(text: string): Buffer {
  const trimmed = text.trim().replace(/\s+/g, '');
  if (!trimmed) throw new Error('Empty key');
  const key = Buffer.from(trimmed, 'base64');
  if (key.length !== KEY_BYTES) {
    throw new Error(`Key must be ${KEY_BYTES} bytes (got ${key.length})`);
  }
  return key;
}

export function isValidKeyText(text: string): boolean {
  try {
    keyFromText(text);
    return true;
  } catch {
    return false;
  }
}

/** First 8 hex characters of SHA-256(key) — shown in the header and the UI. */
export function fingerprint(key: Buffer): string {
  return createHash('sha256').update(key).digest('hex').slice(0, 8);
}

/** `v1.<base64(iv | tag | ciphertext)>` */
export function encryptText(plaintext: string, key: Buffer): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${Buffer.concat([iv, tag, ciphertext]).toString('base64')}`;
}

export function decryptText(payload: string, key: Buffer): string {
  const text = payload.trim();
  if (!text.startsWith('v1.')) {
    throw new Error('Unsupported encrypted payload version');
  }
  const raw = Buffer.from(text.slice(3), 'base64');
  if (raw.length < IV_BYTES + TAG_BYTES + 1) throw new Error('Encrypted payload is truncated');
  const iv = raw.subarray(0, IV_BYTES);
  const tag = raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ciphertext = raw.subarray(IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

/** Wrap a payload in the `Folium-encrypted` fence, 76 characters per line. */
export function wrapEncryptedBody(payload: string): string {
  const lines: string[] = [];
  for (let i = 0; i < payload.length; i += 76) lines.push(payload.slice(i, i + 76));
  return ['```' + ENCRYPTED_FENCE, ...lines, '```', ''].join('\n');
}

const FENCE_RE = new RegExp('```' + ENCRYPTED_FENCE + '\\r?\\n([\\s\\S]*?)\\r?\\n```', 'm');

/** Extract the encrypted payload from a body (undefined when absent). */
export function unwrapEncryptedBody(body: string): string | undefined {
  const match = FENCE_RE.exec(body);
  if (!match) return undefined;
  return match[1].replace(/\s+/g, '');
}

export function hasEncryptedBody(raw: string): boolean {
  return FENCE_RE.test(raw);
}

export function encryptedHeaderValue(key: Buffer): string {
  return `${ALGORITHM}:${fingerprint(key)}`;
}

/** Header value fingerprint (`aes-256-gcm:ab12cd34` -> `ab12cd34`). */
export function fingerprintFromHeader(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const match = /^[a-z0-9-]+:([0-9a-f]{8})$/i.exec(value.trim());
  return match ? match[1].toLowerCase() : undefined;
}

/**
 * Encrypt a note: keep the header and the title line, replace the rest with the
 * `Folium-encrypted` fence, and mark the note `sensitive: true`.
 */
export function encryptNote(raw: string, key: Buffer): string {
  const parsed = parseNote(raw);
  const titleLine = firstHeadingLine(parsed.body)?.text.trim() ?? '';
  const headingText = titleLine.replace(/^#{1,6}\s*/, '').trim();
  const payload = encryptText(removeFirstLine(parsed.body), key);
  const body = `${titleLine ? `${titleLine}\n\n` : ''}${wrapEncryptedBody(payload)}`;
  const split = splitFrontMatter(raw);
  const base = parsed.hasHeader
    ? `${raw.slice(0, split.bodyStart)}${body}`
    : serializeNote({ title: headingText || undefined }, body);
  return setFrontMatterFields(base, [
    ['sensitive', true],
    ['encrypted', encryptedHeaderValue(key)],
  ]);
}

/** Decrypt a note: the title line stays, the fence is replaced by the plain body. */
export function decryptNote(raw: string, key: Buffer): string {
  const parsed = parseNote(raw);
  const payload = unwrapEncryptedBody(parsed.body);
  if (!payload) throw new Error('Note has no Folium-encrypted block');
  const plaintext = decryptText(payload, key);
  const titleLine = firstHeadingLine(parsed.body)?.text.trim() ?? '';
  const body = `${titleLine ? `${titleLine}\n\n` : ''}${plaintext}`;
  const split = splitFrontMatter(raw);
  const updated = setFrontMatterFields(`${raw.slice(0, split.bodyStart)}${body}`, [
    ['sensitive', true],
    ['encrypted', undefined as unknown as string],
  ]);
  return stripEncryptedField(updated);
}

/** Remove only the `encrypted:` line from the header (other bytes untouched). */
export function stripEncryptedField(raw: string): string {
  const split = splitFrontMatter(raw);
  if (!split.hasHeader) return raw;
  const header = split.header.replace(/^encrypted[ \t]*:.*(?:\n[ \t]+.*)*\n?/m, '');
  return `${raw.slice(0, split.headerStart)}${header}${raw.slice(split.headerEnd)}`;
}

function removeFirstLine(body: string): string {
  const heading = firstHeadingLine(body);
  if (!heading) return body;
  const endOfLine = body.indexOf('\n', heading.start);
  if (endOfLine === -1) return '';
  return body.slice(endOfLine + 1).replace(/^\n+/, '');
}

/** Human readable key backup (base64 plus comment lines). */
export function formatKeyBackup(key: Buffer, project?: string): string {
  return [
    '# Folium Notes encryption key',
    `# fingerprint: ${fingerprint(key)}`,
    `# created: ${new Date().toISOString()}`,
    ...(project ? [`# project: ${project}`] : []),
    keyToText(key),
    '',
  ].join('\n');
}

/** Parse a key backup file, with or without the comment header. */
export function parseKeyBackup(text: string): Buffer {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
  if (lines.length === 0) throw new Error('No key found in backup');
  return keyFromText(lines[0]);
}
