import { describe, expect, it } from 'vitest';
import { enmlToMarkdown, sanitizeEnml } from '../../src/core/enml';
import { importEnex } from '../../src/core/importers';

const DIRTY_ENML = [
  '<en-note>',
  '<div>safe</div>',
  '<script>alert(1)</script>',
  '<style>body{background:url(javascript:alert(2))}</style>',
  '<img src="x" onerror="alert(3)">',
  '<a href="javascript:alert(4)">bad link</a>',
  '<iframe src="https://evil.example">frame text</iframe>',
  '<svg onload="alert(5)"><text>svg text</text></svg>',
  '<math><mtext>math text</mtext></math>',
  '</en-note>',
].join('');

describe('ENML sanitization', () => {
  it('removes scripts, styles, frames, SVG/MathML, event handlers and javascript: URLs', () => {
    const clean = sanitizeEnml(DIRTY_ENML);
    expect(clean).toContain('<div>safe</div>');
    expect(clean).not.toMatch(/alert\(/i);
    expect(clean).not.toMatch(/onerror|onload/i);
    expect(clean).not.toMatch(/javascript:/i);
    expect(clean).not.toMatch(/<script|<style|<iframe|<svg|<math/i);
    expect(clean).not.toContain('frame text');
    expect(clean).not.toContain('svg text');
    expect(clean).not.toContain('math text');
  });

  it('drops protocol-relative and data: URLs but keeps https links and images', () => {
    const clean = sanitizeEnml(
      '<en-note><a href="//evil.example/x">protocol relative</a><img src="data:image/svg+xml,<svg onload=alert(1)>" alt="x"><a href="https://example.com/ok">ok</a><img src="https://example.com/a.png" alt="pic"></en-note>',
    );
    expect(clean).not.toMatch(/evil\\.example/i);
    expect(clean).not.toMatch(/data:image/i);
    expect(clean).toContain('href="https://example.com/ok"');
    expect(clean).toContain('src="https://example.com/a.png"');
  });

  it('keeps safe formatting, links, images and exactly one ENML checkbox', () => {
    const md = enmlToMarkdown(
      '<en-note><b>bold</b><a href="https://example.com/ok">link</a><img src="https://example.com/a.png" alt="pic"/><en-todo checked="true"/>Task</en-note>',
    );
    expect(md).toContain('**bold**');
    expect(md).toContain('[link](https://example.com/ok)');
    expect(md).toContain('![pic](https://example.com/a.png)');
    expect(md).toContain('[x] Task');
    expect(md.match(/\[x\]/g)).toHaveLength(1);
  });

  it('produces safe Markdown from malicious ENML', () => {
    const md = enmlToMarkdown(DIRTY_ENML);
    expect(md).toContain('safe');
    expect(md).toContain('bad link');
    expect(md).not.toMatch(/alert|javascript:/i);
    expect(md).not.toMatch(/<script|<iframe|<svg|<math/i);
  });

  it('sanitizes .enex imports end to end', () => {
    const enex = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<en-export><note><title>Dirty import</title><content><![CDATA[',
      '<en-note><div>kept text</div><script>alert(1)</script>',
      '<a href="javascript:alert(2)">click</a><img src="x" onerror="alert(3)">',
      '</en-note>',
      ']]></content></note></en-export>',
    ].join('');
    const notes = importEnex([{ path: 'dirty.enex', content: enex }]);
    expect(notes).toHaveLength(1);
    expect(notes[0].body).toContain('kept text');
    expect(notes[0].body).toContain('click');
    expect(notes[0].body).not.toMatch(/alert|javascript:|onerror/i);
  });
});