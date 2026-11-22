#!/usr/bin/env node
/** Generate the extension icon (PNG) and walkthrough previews (SVG). */
import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';

const root = path.resolve(import.meta.dirname, '..');
const images = path.join(root, 'images');
await fs.mkdir(images, { recursive: true });

function crc32(buffer) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
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

const frame = (title, body) => `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360">
  <rect width="640" height="360" rx="10" fill="#1e2229"/>
  <rect x="0" y="0" width="640" height="34" rx="10" fill="#272d36"/>
  <circle cx="20" cy="17" r="5" fill="#e5534b"/><circle cx="38" cy="17" r="5" fill="#d4a72c"/><circle cx="56" cy="17" r="5" fill="#57ab5a"/>
  <text x="640" y="22" text-anchor="end" fill="#8b949e" font-family="Segoe UI, sans-serif" font-size="12">${title}</text>
  ${body}
</svg>\n`;

const group = (y, label, count) => `<g font-family="Segoe UI, sans-serif">
  <text x="30" y="${y}" fill="#c9d1d9" font-size="14" font-weight="600">▾ ${label}</text>
  <text x="610" y="${y}" fill="#8b949e" font-size="12" text-anchor="end">${count}</text>
</g>`;
const noteRow = (y, dot, title, meta) => `<g font-family="Segoe UI, sans-serif">
  <circle cx="48" cy="${y - 4}" r="4" fill="${dot}"/>
  <text x="64" y="${y}" fill="#e6edf3" font-size="13">${title}</text>
  <text x="610" y="${y}" fill="#8b949e" font-size="11" text-anchor="end">${meta}</text>
</g>`;

await fs.writeFile(
  path.join(images, 'walkthrough-notes.svg'),
  frame(
    'Notes',
    `${group(70, 'Shared', 3)}${noteRow(96, '#e5534b', 'Fix login redirect', '2026-11-22 14:14')}${noteRow(122, '#57ab5a', 'Release checklist', '2026-11-21 09:30')}${noteRow(148, '#539bf5', 'Decision: Redis sessions', '2026-11-20 17:02')}${group(186, 'Private', 2)}${noteRow(212, '#b083f0', 'Credentials — staging', '2026-11-19 11:20')}${noteRow(238, '#8b949e', 'Questions for the architect', '2026-11-18 08:05')}`,
  ),
);

await fs.writeFile(
  path.join(images, 'walkthrough-create.svg'),
  frame(
    'New note',
    `<rect x="120" y="80" width="400" height="200" rx="8" fill="#272d36" stroke="#3d444d"/>
     <text x="145" y="112" fill="#e6edf3" font-family="Segoe UI, sans-serif" font-size="14" font-weight="600">New note</text>
     <rect x="145" y="130" width="350" height="30" rx="5" fill="#1e2229" stroke="#3d444d"/>
     <text x="156" y="150" fill="#8b949e" font-family="Segoe UI, sans-serif" font-size="13">Fix login redirect</text>
     <text x="145" y="186" fill="#c9d1d9" font-family="Segoe UI, sans-serif" font-size="12">◉ Shared note — committed in .notes/</text>
     <text x="145" y="210" fill="#c9d1d9" font-family="Segoe UI, sans-serif" font-size="12">○ Private note — ~/FoliumNotes/…</text>
     <rect x="430" y="238" width="65" height="26" rx="5" fill="#238636"/>
     <text x="462" y="256" fill="#ffffff" text-anchor="middle" font-family="Segoe UI, sans-serif" font-size="12">Create</text>`,
  ),
);

await fs.writeFile(
  path.join(images, 'walkthrough-templates.svg'),
  frame(
    'Templates',
    `${noteRow(80, '#539bf5', 'Bug investigation', 'built-in')}${noteRow(110, '#539bf5', 'Meeting notes', 'built-in')}${noteRow(140, '#539bf5', 'Decision record', 'built-in')}${noteRow(170, '#539bf5', 'Manual test prerequisites', 'built-in')}${noteRow(200, '#b083f0', 'Credentials', 'built-in · private')}${noteRow(230, '#d4a72c', 'Team bug flow', 'team')}${noteRow(260, '#57ab5a', 'My standup', 'mine')}`,
  ),
);

await fs.writeFile(
  path.join(images, 'walkthrough-tasks.svg'),
  frame(
    'Tasks',
    `${group(70, 'Today', 2)}${noteRow(96, '#d4a72c', 'Write regression test', 'Fix login')}${noteRow(122, '#d4a72c', 'Update docs', 'Release checklist')}${group(158, 'Overdue', 1)}${noteRow(184, '#e5534b', 'Rotate staging credentials', 'Credentials — staging')}${group(220, 'Next 7 days', 1)}${noteRow(246, '#57ab5a', 'Review ADR', 'Decision: Redis sessions')}`,
  ),
);

await fs.writeFile(
  path.join(images, 'walkthrough-ai.svg'),
  frame(
    'AI follow-up',
    `<rect x="40" y="70" width="560" height="60" rx="6" fill="#272d36"/>
     <text x="56" y="96" fill="#c9d1d9" font-family="Segoe UI, sans-serif" font-size="12">Copilot: “Should we cache sessions? Option A: Redis. Option B: Postgres.”</text>
     <text x="56" y="116" fill="#8b949e" font-family="Segoe UI, sans-serif" font-size="11">#followUp — turns the answer into a shared note</text>
     <rect x="40" y="150" width="560" height="150" rx="6" fill="#1b1f24" stroke="#3d444d"/>
     <text x="56" y="178" fill="#e6edf3" font-family="Segoe UI, sans-serif" font-size="13" font-weight="600">Follow-up: Should we cache sessions?</text>
     <text x="56" y="204" fill="#c9d1d9" font-family="Segoe UI, sans-serif" font-size="12">- Should we cache sessions?</text>
     <text x="72" y="226" fill="#8b949e" font-family="Segoe UI, sans-serif" font-size="12">- Answer: Redis</text>
     <text x="72" y="248" fill="#8b949e" font-family="Segoe UI, sans-serif" font-size="12">- [x] Redis</text>
     <text x="72" y="270" fill="#8b949e" font-family="Segoe UI, sans-serif" font-size="12">- [ ] Postgres</text>`,
  ),
);

console.log('[images] icon.png + gutter icons + folium.svg + 5 walkthrough previews');
