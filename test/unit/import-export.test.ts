import { describe, expect, it } from 'vitest';
import { importEnex, importJex, importMarkdownFolder, obsidianLinks, previewImport } from '../../src/core/importers';
import { exportNotes, exportTargetWarning } from '../../src/core/exporters';
import { enmlToMarkdown } from '../../src/core/enml';
import { writeTar } from '../../src/core/tar';
import { normalizeMeta } from '../../src/core/frontmatter';

describe('markdown import', () => {
  it('reads front matter, keywords and folder tags', () => {
    const notes = importMarkdownFolder([
      {
        path: 'Projects/Alpha/plan.md',
        content: [
          '---',
          'title: Alpha plan',
          'tags: [ roadmap ]',
          'keywords: "q4, launch"',
          'created: 2026-01-05',
          '---',
          '',
          '# Alpha plan',
          '',
          'See [Beta](Beta.md) and [Gamma](./sub/Gamma.md#top).',
          '',
        ].join('\n'),
      },
    ]);
    expect(notes).toHaveLength(1);
    expect(notes[0].title).toBe('Alpha plan');
    expect(notes[0].tags).toEqual(['roadmap', 'q4', 'launch', 'projects', 'alpha']);
    expect(notes[0].body).toContain('[[Beta]]');
    expect(notes[0].body).toContain('[[Gamma#top]]');
    expect(notes[0].importedFrom).toBe('md:Projects/Alpha/plan.md');
    expect(notes[0].created?.getFullYear()).toBe(2026);
  });

  it('converts links with labels', () => {
    expect(obsidianLinks('[the plan](notes/Plan.md)')).toBe('[[Plan|the plan]]');
    expect(obsidianLinks('[Plan](Plan.md)')).toBe('[[Plan]]');
  });
});

describe('joplin import', () => {
  function jex(): Buffer {
    const item = (body: string) => Buffer.from(body, 'utf8');
    return writeTar([
      { name: 'nb1.md', type: 'file', data: item('---\nid: nb1\ntype_: 2\ntitle: Work\n---\n\n'), mode: 0o644, mtime: 1 },
      {
        name: 'n1.md',
        type: 'file',
        data: item('---\nid: n1\nparent_id: nb1\ntype_: 1\ntitle: Deploy\ncreated_time: 1700000000000\nis_todo: 1\ntodo_due: 1700100000000\n---\n\nDeploy steps, see [Runbook](:/n2).'),
        mode: 0o644,
        mtime: 1,
      },
      {
        name: 'n2.md',
        type: 'file',
        data: item('---\nid: n2\ntype_: 1\ntitle: Runbook\n---\n\nHow to run.'),
        mode: 0o644,
        mtime: 1,
      },
      { name: 't1.md', type: 'file', data: item('---\nid: t1\ntype_: 5\ntitle: Ops\n---\n\n'), mode: 0o644, mtime: 1 },
      {
        name: 'r1.md',
        type: 'file',
        data: item('---\nid: r1\ntype_: 6\nnote_id: n1\ntag_id: t1\n---\n\n'),
        mode: 0o644,
        mtime: 1,
      },
    ]);
  }

  it('maps notebooks, links, tags and to-dos with due dates', () => {
    const notes = importJex([{ path: 'export.jex', content: jex() }]);
    const deploy = notes.find((note) => note.title === 'Deploy')!;
    expect(deploy.importedFrom).toBe('joplin:n1');
    expect(deploy.joplinId).toBe('n1');
    expect(deploy.tags).toContain('ops');
    expect(deploy.tags).toContain('work');
    expect(deploy.body).toContain('- [ ] Deploy due:2023-11-16');
    expect(deploy.body).toContain('[[Runbook]]');
    expect(deploy.created?.getTime()).toBe(1700000000000);
    expect(notes.find((note) => note.title === 'Runbook')).toBeTruthy();
  });
});

describe('evernote import', () => {
  const enex = `<?xml version="1.0" encoding="UTF-8"?>
<en-export>
<note>
<title>Groceries &amp; plans</title>
<content><![CDATA[<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE en-note SYSTEM "http://xml.evernote.com/pub/enml2.dtd">
<en-note><div>Buy milk</div><ul><li>eggs</li><li>bread</li></ul><en-todo checked="true"/>Done item<en-todo/>Open item<div><a href="https://example.com">link</a></div></en-note>]]></content>
<created>20260105T120000Z</created>
<updated>20260106T120000Z</updated>
<tag>home</tag>
<tag>shopping</tag>
</note>
</en-export>`;

  it('converts ENML to Markdown with checkboxes and lists', () => {
    const md = enmlToMarkdown(
      '<en-note><div>One</div><div>Two</div><ul><li>a</li><li>b</li></ul><en-todo checked="true"/>Done</en-note>',
    );
    expect(md).toContain('One');
    expect(md).toContain('- a');
    expect(md).toContain('[x] Done');
  });

  it('imports notes with tags and dates', () => {
    const notes = importEnex([{ path: 'my.enex', content: enex }]);
    expect(notes).toHaveLength(1);
    expect(notes[0].title).toBe('Groceries & plans');
    expect(notes[0].tags).toEqual(['home', 'shopping']);
    expect(notes[0].body).toContain('- eggs');
    expect(notes[0].body).toContain('[x] Done item');
    expect(notes[0].body).toContain('[link](https://example.com)');
    expect(notes[0].created?.toISOString()).toBe('2026-01-05T12:00:00.000Z');
  });
});

describe('preview and dedupe', () => {
  it('skips duplicates by imported_from', () => {
    const files = [{ path: 'a.md', content: '# A\n' }];
    const preview = previewImport('markdown', files, {
      importedFrom: new Set(['md:a.md']),
      ids: new Set(),
    });
    expect(preview.total).toBe(0);
    expect(preview.duplicates).toBe(1);
  });
});

describe('export', () => {
  const base = {
    relPath: 'a.md',
    scope: 'shared' as const,
    title: 'Fix login',
    body: '# Fix login\n\nSee [[Other note]].\n',
    meta: normalizeMeta({ id: '01J0ABCDEFGHJKMNPQRSTVWXYZ' }),
    created: new Date(2026, 10, 22, 10),
    updated: new Date(2026, 10, 22, 11),
    tags: ['bug'],
    sensitive: false,
    encrypted: false,
  };

  it('writes Obsidian markdown and skips sensitive notes', () => {
    const result = exportNotes([base, { ...base, relPath: 'b.md', title: 'Secret', sensitive: true }], {
      format: 'markdown',
      scope: 'both',
    });
    expect(result.files).toHaveLength(1);
    expect(result.files[0].path).toBe('2026-11-22-fix-login.md');
    expect(result.files[0].content).toContain('title: Fix login');
    expect(result.files[0].content).toContain('[[Other note]]');
    expect(result.skipped).toEqual([{ relPath: 'b.md', reason: 'sensitive' }]);
  });

  it('rewrites wiki links to relative links for Joplin', () => {
    const other = { ...base, relPath: 'other.md', title: 'Other note' };
    const result = exportNotes([base, other], { format: 'joplin', scope: 'shared' });
    const file = result.files.find((f) => f.content.includes('Fix login'))!;
    expect(file.content).toContain('[Other note](2026-11-22-other-note.md)');
    expect(file.content).toContain('updated:');
  });

  it('warns when exporting into the project folder', () => {
    expect(exportTargetWarning('/repo/.notes/export', '/repo')).toContain('inside the project');
    expect(exportTargetWarning('/tmp/export', '/repo')).toBeUndefined();
  });
});
