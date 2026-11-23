#!/usr/bin/env node
/** Generate the extension icon (PNG) and walkthrough previews (SVG). */
import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';

const root = path.resolve(import.meta.dirname, '..');
const images = path.join(root, 'images');
await fs.mkdir(images, { recursive: true });

let crcTable;

function crc32(buffer) {
  if (!crcTable) {
    crcTable = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c;
    }
  }
  const table = crcTable;
  let crc = -1;
  for (const byte of buffer) crc = (crc >>> 8) ^ table[(crc ^ byte) & 0xff];
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData));
  return Buffer.concat([length, typeAndData, crc]);
}

function png(width, height, pixel) {
  const stride = width * 4 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0;
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = pixel(x, y);
      const offset = y * stride + 1 + x * 4;
      raw[offset] = r;
      raw[offset + 1] = g;
      raw[offset + 2] = b;
      raw[offset + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const SIZE = 256;
const leaf = (x, y) => {
  // Normalised coordinates in [-1, 1].
  const nx = (x - SIZE / 2) / (SIZE / 2);
  const ny = (y - SIZE / 2) / (SIZE / 2);
  const t = (nx + 1) / 2;
  const halfWidth = 0.62 * Math.sin(Math.PI * Math.min(1, t));
  const curve = 0.35 * (t - 0.5) ** 2 - 0.12;
  return Math.abs(ny - curve) < halfWidth * 0.62 && t > 0 && t < 1;
};

const icon = png(SIZE, SIZE, (x, y) => {
  const cx = x - SIZE / 2;
  const cy = y - SIZE / 2;
  const radius = SIZE / 2 - 6;
  const inside = cx * cx + cy * cy <= radius * radius;
  if (!inside) return [0, 0, 0, 0];
  if (!leaf(x, y)) return [24, 92, 68, 255];
  const vein = Math.abs(x - SIZE / 2 - (y - SIZE / 2) * 0.28) < 3 && y > SIZE * 0.35 && y < SIZE * 0.8;
  if (vein) return [18, 66, 50, 255];
  const shade = 1 - (y / SIZE) * 0.25;
  return [Math.round(120 * shade), Math.round(220 * shade), Math.round(150 * shade), 255];
});
await fs.writeFile(path.join(images, 'icon.png'), icon);

const GUTTER_COLORS = {
  red: [229, 83, 75],
  orange: [224, 130, 61],
  yellow: [212, 167, 44],
  green: [87, 171, 90],
  blue: [83, 155, 245],
  purple: [176, 131, 240],
  pink: [226, 117, 173],
  gray: [139, 148, 158],
  lost: [229, 83, 75],
};
for (const [name, [r, g, b]] of Object.entries(GUTTER_COLORS)) {
  const dot = png(16, 16, (x, y) => {
    const dx = x - 7.5;
    const dy = y - 7.5;
    const inside = dx * dx + dy * dy <= 25;
    return inside ? [r, g, b, 255] : [0, 0, 0, 0];
  });
  await fs.writeFile(path.join(images, `gutter-${name}.png`), dot);
}

const leafPath =
  'M12 2C8 4 4 7 4 12c0 4 3 7 8 10 5-3 8-6 8-10 0-5-4-8-8-10zm0 3.2c2.6 1.6 5.2 3.9 5.2 6.8 0 2.6-1.8 4.9-5.2 7.2-3.4-2.3-5.2-4.6-5.2-7.2 0-2.9 2.6-5.2 5.2-6.8z';
await fs.writeFile(
  path.join(images, 'folium.svg'),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="${leafPath}"/></svg>\n`,
);

const viewIcons = {
  'view-notes.svg': '<path d="M6 2h9l4 4v16H6z" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M9 9h7M9 13h7M9 17h4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  'view-tags.svg': '<path d="M3 4h8l10 10-8 8L3 12z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><circle cx="8" cy="9" r="2" fill="currentColor"/>',
  'view-tasks.svg': '<path d="M4 5h16M4 12h16M4 19h16" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M2 5l1.2 1.2L5.5 4M2 12l1.2 1.2L5.5 11" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round"/>',
  'view-related.svg': '<path d="M9.5 14.5l5-5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M11 7l1.5-1.5a3.5 3.5 0 015 5L16 12M13 17l-1.5 1.5a3.5 3.5 0 01-5-5L8 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
};
for (const [name, body] of Object.entries(viewIcons)) {
  await fs.writeFile(
    path.join(images, name),
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none">${body}</svg>\n`,
  );
}

console.log('[images] icon.png + gutter icons + view icons + folium.svg');
