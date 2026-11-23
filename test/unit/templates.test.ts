import { describe, expect, it } from 'vitest';
import {
  BUILTIN_TEMPLATES,
  collectTemplates,
  parseTemplateFile,
  renderTemplate,
  resolveDefaultTemplate,
  sampleContext,
  templateFileContent,
  templatesForScope,
  validateTemplate,
} from '../../src/core/templates';

describe('built-in templates', () => {
  it('contains every documented template', () => {
    const names = BUILTIN_TEMPLATES.map((template) => template.name);
    expect(names).toEqual([
      'Bug investigation',
      'Meeting notes',
      'Decision record',
      'Manual test prerequisites',
      'Credentials',
      'Today I learned',
      'Checklist',
      'Branch note',
      'AI prompt',
      'Terminal Prompts',
      'Other',
    ]);
  });

  it('ships a Terminal Prompts template with sendable command lines', () => {
    const terminal = BUILTIN_TEMPLATES.find((template) => template.name === 'Terminal Prompts')!;
    expect(terminal.tags).toEqual(['terminal']);
    expect(terminal.body).toContain('# {{title}}');
    expect(terminal.body).toContain('npm test');
    expect(terminal.body).toContain('{{cursor}}');
    expect(terminal.body).toContain('```bash');
  });

  it('marks credentials private and sensitive and the AI prompt shared/prompt', () => {
    const credentials = BUILTIN_TEMPLATES.find((t) => t.name === 'Credentials')!;
    expect(credentials.privateOnly).toBe(true);
    expect(credentials.sensitive).toBe(true);
    const prompt = BUILTIN_TEMPLATES.find((t) => t.name === 'AI prompt')!;
    expect(prompt.sharedOnly).toBe(true);
    expect(prompt.kind).toBe('prompt');
    expect(prompt.body).toContain('{{selection}}');
  });

  it('puts a bash block under Prerequisites for the manual test template', () => {
    const manual = BUILTIN_TEMPLATES.find((t) => t.name === 'Manual test prerequisites')!;
    expect(manual.body).toContain('## Prerequisites');
    expect(manual.body).toMatch(/## Prerequisites[\s\S]*```bash/);
  });

  it('has a credentials table with the documented columns', () => {
    const credentials = BUILTIN_TEMPLATES.find((t) => t.name === 'Credentials')!;
    expect(credentials.body).toContain('| No | Name | Username | Password |');
  });
});

describe('renderTemplate', () => {
  it('fills every basic placeholder', () => {
    const result = renderTemplate(
      '{{title}}|{{date}}|{{time}}|{{datetime}}|{{user}}|{{project}}|{{branch}}|{{cursor}}',
      sampleContext(),
    );
    expect(result.text).toBe('Fix login redirect|2026-11-22|14:14|2026-11-22 14:14|Ada Lovelace|github.com/acme/webapp|feature/login|');
    expect(result.cursorOffset).toBe(result.text.length);
  });

  it('collects unanswered ask questions and applies answers', () => {
    const body = '{{ask:Which tool?|Copilot|Cline}} and {{ask:Which tool?}}';
    const first = renderTemplate(body, { ...sampleContext(), answers: {} });
    expect(first.questions).toEqual([{ question: 'Which tool?', options: ['Copilot', 'Cline'] }]);
    const answered = renderTemplate(body, { ...sampleContext(), answers: { 'Which tool?': 'Cline' } });
    expect(answered.text).toBe('Cline and Cline');
    expect(answered.questions).toEqual([]);
  });

  it('fills prompt placeholders', () => {
    const result = renderTemplate('{{selection}} {{file}} {{language}} {{clipboard}}', sampleContext());
    expect(result.text).toBe('return redirect(url); src/auth/login.ts typescript Paste from clipboard');
  });

  it('leaves unknown placeholders and reports them', () => {
    const result = renderTemplate('{{nope}}', {});
    expect(result.text).toBe('{{nope}}');
    expect(result.unknown).toEqual(['nope']);
  });
});

describe('validateTemplate', () => {
  it('suggests unknown placeholders', () => {
    const problems = validateTemplate('{{titel}}');
    expect(problems[0].severity).toBe('error');
    expect(problems[0].suggestion).toContain('{{title}}');
  });

  it('warns when prompt-only placeholders are used outside prompts', () => {
    const problems = validateTemplate('{{selection}}', { kind: 'note' });
    expect(problems[0].severity).toBe('warning');
    expect(validateTemplate('{{selection}}', { kind: 'prompt' })).toEqual([]);
  });

  it('reports empty asks, duplicate cursors and bad options', () => {
    expect(validateTemplate('{{ask:}}')[0].message).toContain('empty');
    expect(validateTemplate('{{cursor}} {{cursor}}')[0].message).toContain('Only one');
    const duplicate = validateTemplate('{{ask:Pick|A|a}}');
    expect(duplicate[0].message).toContain('Duplicate');
    const tooMany = validateTemplate('{{ask:Pick|1|2|3|4|5|6|7}}');
    expect(tooMany[0].message).toContain('Too many');
  });
});

describe('template files', () => {
  const raw = [
    '---',
    'template:',
    '  name: Team bug',
    '  description: Our bug flow',
    '  scope: shared',
    '  sharedOnly: true',
    'tags: [ bug, team ]',
    'color: orange',
    'status: triage',
    '---',
    '',
    '# {{title}}',
    '',
    '{{cursor}}',
    '',
  ].join('\n');

  it('parses the template map and copies other fields', () => {
    const template = parseTemplateFile(raw, '.templates/bug.md')!;
    expect(template.name).toBe('Team bug');
    expect(template.description).toBe('Our bug flow');
    expect(template.scope).toBe('shared');
    expect(template.sharedOnly).toBe(true);
    expect(template.tags).toEqual(['bug', 'team']);
    expect(template.color).toBe('orange');
    expect(template.extra?.status).toBe('triage');
    expect(template.body.startsWith('# {{title}}')).toBe(true);
  });

  it('round-trips template file content', () => {
    const content = templateFileContent({
      name: 'My template',
      description: 'Does: things',
      scope: 'private',
      tags: ['x'],
      kind: 'prompt',
      body: '# {{title}}\n',
    });
    const parsed = parseTemplateFile(content)!;
    expect(parsed.name).toBe('My template');
    expect(parsed.scope).toBe('private');
    expect(parsed.kind).toBe('prompt');
  });

  it('applies team > personal > built-in precedence', () => {
    const personal = parseTemplateFile(templateFileContent({ name: 'Bug investigation', body: 'personal' }))!;
    const team = parseTemplateFile(templateFileContent({ name: 'Bug investigation', body: 'team' }))!;
    const merged = collectTemplates([team], [personal]);
    const bug = merged.find((template) => template.name === 'Bug investigation')!;
    expect(bug.body.trim()).toBe('team');
    const onlyPersonal = collectTemplates([], [personal]).find((t) => t.name === 'Bug investigation')!;
    expect(onlyPersonal.body.trim()).toBe('personal');
    expect(onlyPersonal.builtin).toBeUndefined();
  });

  it('filters templates by scope', () => {
    const visibleShared = templatesForScope(BUILTIN_TEMPLATES, 'shared').map((t) => t.name);
    expect(visibleShared).not.toContain('Credentials');
    expect(visibleShared).toContain('AI prompt');
    const visiblePrivate = templatesForScope(BUILTIN_TEMPLATES, 'private').map((t) => t.name);
    expect(visiblePrivate).toContain('Credentials');
    expect(visiblePrivate).not.toContain('AI prompt');
  });

  it('resolves the default template setting', () => {
    expect(resolveDefaultTemplate('', BUILTIN_TEMPLATES)).toEqual({ kind: 'blank' });
    expect(resolveDefaultTemplate('ask', BUILTIN_TEMPLATES)).toEqual({ kind: 'ask' });
    const resolved = resolveDefaultTemplate('meeting notes', BUILTIN_TEMPLATES);
    expect(resolved.kind).toBe('template');
    expect(resolveDefaultTemplate('missing', BUILTIN_TEMPLATES)).toEqual({ kind: 'blank' });
  });
});
