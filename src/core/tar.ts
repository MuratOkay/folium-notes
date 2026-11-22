/** Minimal tar (ustar + GNU long names + pax path) reader/writer, no dependencies. */

export interface TarEntry {
  name: string;
  type: 'file' | 'directory' | 'symlink' | 'other';
  data: Buffer;
  mode: number;
  mtime: number;
}

const BLOCK = 512;

function octal(value: number, length: number): string {
  const text = Math.max(0, Math.floor(value)).toString(8);
  return `${text.padStart(length - 1, '0')}\0`;
}

function checksum(header: Buffer): number {
  let sum = 0;
  for (let i = 0; i < BLOCK; i++) sum += i >= 148 && i < 156 ? 32 : header[i];
  return sum;
}

function headerFor(entry: TarEntry, name: string): Buffer {
  const header = Buffer.alloc(BLOCK, 0);
  Buffer.from(name, 'utf8').copy(header, 0, 0, Math.min(100, Buffer.byteLength(name, 'utf8')));
  header.write(octal(entry.mode || 0o644, 8), 100, 8, 'ascii');
  header.write(octal(0, 8), 108, 8, 'ascii');
  header.write(octal(0, 8), 116, 8, 'ascii');
  header.write(octal(entry.data.length, 12), 124, 12, 'ascii');
  header.write(octal(entry.mtime || Math.floor(Date.now() / 1000), 12), 136, 12, 'ascii');
  header.write('        ', 148, 8, 'ascii');
  header.write(entry.type === 'directory' ? '5' : entry.type === 'symlink' ? '2' : '0', 156, 1, 'ascii');
  header.write('ustar\0', 257, 6, 'ascii');
  header.write('00', 263, 2, 'ascii');
  const sum = checksum(header);
  header.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'ascii');
  return header;
}

function needsLongName(name: string): boolean {
  return Buffer.byteLength(name, 'utf8') > 100;
}

function longNameEntry(name: string, mtime: number): Buffer {
  const data = Buffer.from(`${name}\0`, 'utf8');
  const header = headerFor({ name: '././@LongLink', data, mode: 0o644, mtime, type: 'other' }, '././@LongLink');
  header.write('L', 156, 1, 'ascii');
  const padded = Buffer.alloc(Math.ceil(data.length / BLOCK) * BLOCK, 0);
  data.copy(padded);
  return Buffer.concat([header, padded]);
}

/** Write a tar archive (GNU long names for paths over 100 bytes). */
export function writeTar(entries: TarEntry[]): Buffer {
  const chunks: Buffer[] = [];
  for (const entry of entries) {
    const name = entry.name.replace(/\\/g, '/').replace(/^\/+/, '');
    const mtime = entry.mtime || Math.floor(Date.now() / 1000);
    if (needsLongName(name)) chunks.push(longNameEntry(name, mtime));
    const short = needsLongName(name) ? name.slice(-100) : name;
    chunks.push(headerFor({ ...entry, mtime }, short));
    if (entry.type !== 'directory') {
      const padded = Buffer.alloc(Math.ceil(entry.data.length / BLOCK) * BLOCK, 0);
      entry.data.copy(padded);
      chunks.push(padded);
    }
  }
  chunks.push(Buffer.alloc(BLOCK * 2, 0));
  return Buffer.concat(chunks);
}

function readOctal(buffer: Buffer): number {
  const text = buffer.toString('ascii').replace(/\0.*$/, '').trim();
  if (!text) return 0;
  const value = parseInt(text, 8);
  return Number.isFinite(value) ? value : 0;
}

function readString(buffer: Buffer): string {
  const zero = buffer.indexOf(0);
  const slice = zero === -1 ? buffer : buffer.subarray(0, zero);
  return slice.toString('utf8');
}

function parsePax(data: Buffer): Record<string, string> {
  const out: Record<string, string> = {};
  let offset = 0;
  const text = data.toString('utf8');
  while (offset < text.length) {
    const space = text.indexOf(' ', offset);
    if (space === -1) break;
    const length = Number(text.slice(offset, space));
    if (!Number.isFinite(length) || length <= 0) break;
    const record = text.slice(space + 1, offset + length - 1);
    const eq = record.indexOf('=');
    if (eq !== -1) out[record.slice(0, eq)] = record.slice(eq + 1);
    offset += length;
  }
  return out;
}

/** Read a tar archive (ustar, GNU longname, pax path/size). */
export function readTar(buffer: Buffer): TarEntry[] {
  const entries: TarEntry[] = [];
  let offset = 0;
  let pendingName: string | undefined;
  let pendingSize: number | undefined;
  while (offset + BLOCK <= buffer.length) {
    const header = buffer.subarray(offset, offset + BLOCK);
    if (header.every((byte) => byte === 0)) break;
    const rawName = readString(header.subarray(0, 100));
    const prefix = readString(header.subarray(345, 500));
    const size = readOctal(header.subarray(124, 136));
    const mtime = readOctal(header.subarray(136, 148));
    const typeFlag = String.fromCharCode(header[156] || 48);
    const mode = readOctal(header.subarray(100, 108));
    const dataStart = offset + BLOCK;
    const dataLength = pendingSize ?? size;
    const padded = Math.ceil(dataLength / BLOCK) * BLOCK;
    const data = buffer.subarray(dataStart, dataStart + Math.min(dataLength, buffer.length - dataStart));
    offset = dataStart + padded;

    if (typeFlag === 'L') {
      pendingName = readString(data);
      continue;
    }
    if (typeFlag === 'x') {
      const pax = parsePax(data);
      if (pax.path) pendingName = pax.path;
      if (pax.size) pendingSize = Number(pax.size);
      continue;
    }
    if (typeFlag === 'g') continue;
    if (typeFlag === 'K') continue;
    pendingSize = undefined;
    const name = (pendingName ?? (prefix ? `${prefix}/${rawName}` : rawName)).replace(/^\.\//, '');
    pendingName = undefined;
    if (!name) continue;
    if (typeFlag === '5') {
      entries.push({ name, type: 'directory', data: Buffer.alloc(0), mode, mtime });
      continue;
    }
    if (typeFlag === '2') {
      entries.push({ name, type: 'symlink', data: Buffer.alloc(0), mode, mtime });
      continue;
    }
    if (typeFlag !== '0' && typeFlag !== '\0') {
      entries.push({ name, type: 'other', data: Buffer.from(data), mode, mtime });
      continue;
    }
    entries.push({ name, type: 'file', data: Buffer.from(data), mode, mtime });
  }
  return entries;
}
