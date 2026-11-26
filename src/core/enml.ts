/** Evernote ENML (XHTML) to Markdown conversion used by the .enex importer. */

import sanitizeHtml from 'sanitize-html';

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  copy: '©',
  reg: '®',
  trade: '™',
  rsquo: '’',
  lsquo: '‘',
  ldquo: '“',
  rdquo: '”',
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (_m, entity: string) => {
    if (entity.startsWith('#x') || entity.startsWith('#X')) {
      const code = parseInt(entity.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : _m;
    }
    if (entity.startsWith('#')) {
      const code = parseInt(entity.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : _m;
    }
    return ENTITIES[entity.toLowerCase()] ?? _m;
  });
}

function attr(tag: string, name: string): string | undefined {
  const match = new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i').exec(tag);
  return match ? match[2] ?? match[3] : undefined;
}

/** Tags ENML needs on top of sanitize-html's XHTML defaults (en-note/en-todo/en-media). */
const ALLOWED_TAGS = [
  ...new Set([
    ...sanitizeHtml.defaults.allowedTags,
    'en-note',
    'en-todo',
    'en-media',
    'img',
    'center',
    'font',
    'u',
    's',
    'strike',
    'sub',
    'sup',
    'mark',
    'dl',
    'dt',
    'dd',
    'figure',
    'figcaption',
  ]),
];

/** Attributes required for note content; no style/class/event handlers and no target/rel. */
const ALLOWED_ATTRIBUTES = {
  ...sanitizeHtml.defaults.allowedAttributes,
  a: ['href', 'title'],
  img: ['src', 'alt', 'title', 'width', 'height'],
  'en-todo': ['checked'],
  'en-media': ['hash', 'type', 'width', 'height'],
  td: ['colspan', 'rowspan'],
  th: ['colspan', 'rowspan'],
};

/**
 * Sanitize untrusted ENML/HTML from an `.enex` import (or any HTML we convert).
 * Scripts, styles, frames/objects/SVG/MathML, event-handler attributes and
 * `javascript:`/`data:` URLs are removed; safe links, images and ENML
 * checkboxes survive.
 */
export function sanitizeEnml(enml: string): string {
  return sanitizeHtml(enml, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: ALLOWED_ATTRIBUTES,
    allowedSchemes: ['http', 'https', 'mailto'],
    allowedSchemesByTag: { img: ['http', 'https'] },
    allowProtocolRelative: false,
    disallowedTagsMode: 'discard',
    allowedClasses: {
      code: ['language-*', 'lang-*'],
      pre: ['language-*', 'lang-*'],
    },
    nonTextTags: ['style', 'script', 'textarea', 'option', 'noscript', 'iframe', 'object', 'embed', 'svg', 'math'],
  });
}

/** Convert ENML/HTML body to Markdown (lists, links, pre, inline styles, checkboxes). */
export function enmlToMarkdown(enml: string): string {
  const cleaned = enml
    .replace(/<\?xml[\s\S]*?\?>/gi, '')
    .replace(/<!DOCTYPE[^>]*>/gi, '')
    .replace(/<en-note[^>]*>/gi, '')
    .replace(/<\/en-note>/gi, '');
  const source = sanitizeEnml(cleaned);
  let out = '';
  let skipDepth = 0;
  const listStack: Array<'ul' | 'ol'> = [];
  const linkStack: Array<{ href: string; text: string }> = [];
  let inPre = 0;
  const tagRe = /<\/?([a-zA-Z0-9:-]+)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  const pushText = (text: string): void => {
    const decoded = decodeEntities(text).replace(/\u00a0/g, ' ');
    if (inPre > 0) {
      out += decoded;
      return;
    }
    out += decoded.replace(/\s+/g, ' ');
    if (linkStack.length > 0) linkStack[linkStack.length - 1].text += decoded;
  };
  while ((match = tagRe.exec(source)) !== null) {
    if (match.index > lastIndex) pushText(source.slice(lastIndex, match.index));
    lastIndex = tagRe.lastIndex;
    const closing = match[0].startsWith('</');
    const name = match[1].toLowerCase();
    const selfClosing = match[3] === '/';
    if (name === 'style' || name === 'script') {
      if (!closing && !selfClosing) skipDepth++;
      else if (closing && skipDepth > 0) skipDepth--;
      continue;
    }
    if (skipDepth > 0) continue;
    switch (name) {
      case 'br':
        out += '\n';
        break;
      case 'div':
      case 'p':
        if (closing) out += '\n\n';
        else if (out && !out.endsWith('\n\n')) out += out.endsWith('\n') ? '\n' : '';
        break;
      case 'h1':
      case 'h2':
      case 'h3':
      case 'h4':
      case 'h5':
      case 'h6':
        out += closing ? '\n\n' : `\n\n${'#'.repeat(Number(name[1]))} `;
        break;
      case 'ul':
      case 'ol':
        if (closing) {
          listStack.pop();
          out += '\n';
        } else if (!selfClosing) {
          listStack.push(name);
          out += out && !out.endsWith('\n') ? '\n' : '';
        }
        break;
      case 'li': {
        if (closing) {
          if (listStack[listStack.length - 1] === 'ul' && out.includes('- [ ]')) out += '\n';
          else out += '\n';
          break;
        }
        const indent = '  '.repeat(Math.max(0, listStack.length - 1));
        out += `${out && !out.endsWith('\n') ? '\n' : ''}${indent}${listStack[listStack.length - 1] === 'ol' ? '1. ' : '- '}`;
        break;
      }
      case 'en-todo': {
        if (closing) break;
        const checked = (attr(match[0], 'checked') ?? '').toLowerCase() === 'true';
        out += checked ? '[x] ' : '[ ] ';
        break;
      }
      case 'b':
      case 'strong':
        out += '**';
        break;
      case 'i':
      case 'em':
        out += '*';
        break;
      case 'code':
        if (inPre === 0) out += '`';
        break;
      case 'pre':
        if (closing) {
          inPre = Math.max(0, inPre - 1);
          out += '\n```\n\n';
        } else {
          inPre++;
          out += '\n```\n';
        }
        break;
      case 'a': {
        if (closing) {
          const link = linkStack.pop();
          if (link?.href) out += `](${link.href})`;
        } else {
          const href = attr(match[0], 'href') ?? '';
          linkStack.push({ href, text: '' });
          if (href) out += '[';
        }
        break;
      }
      case 'img': {
        const src = attr(match[0], 'src') ?? '';
        const alt = attr(match[0], 'alt') ?? '';
        if (src) out += `![${alt}](${src})`;
        break;
      }
      default:
        break;
    }
  }
  if (lastIndex < source.length) pushText(source.slice(lastIndex));
  return out
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\s+/, '')
    .trim() + '\n';
}
