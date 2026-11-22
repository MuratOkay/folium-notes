import { describe, expect, it } from 'vitest';
import {
  composeAnswersReply,
  composeFollowUpBody,
  followUpTitle,
  hasFollowUpContent,
  parseFollowUp,
  parseFollowUpBlock,
  parseFollowUpNote,
  parseFollowUpRequest,
} from '../../src/core/followup';

describe('follow-up parsing', () => {
  it('reads a followup YAML block', () => {
    const source = [
      'Some answer',
      '',
      '```followup',
      'questions:',
      '  - question: Should we cache?',
      '    options: [Memory, Redis]',
      'decisions:',
      '  - Use Redis for sessions',
      'openItems:',
      '  - Update docs',
      '```',
    ].join('\n');
    const data = parseFollowUpBlock(source)!;
    expect(data.questions).toEqual([{ question: 'Should we cache?', options: ['Memory', 'Redis'] }]);
    expect(data.decisions).toEqual(['Use Redis for sessions']);
    expect(data.openItems).toEqual(['Update docs']);
    expect(parseFollowUp(source).questions).toHaveLength(1);
  });

  it('reads Questions/Decisions headings, options and question sentences', () => {
    const source = [
      '## Questions',
      '- Do we need pagination?',
      '- Which database?',
      '',
      '## Decisions',
      '- Use Postgres',
      '',
      '## Open items',
      '- [ ] Migrate data',
      '',
      'Option A: Postgres 16',
      'Option B: Postgres 15',
      '',
      'This works well. Should we ship it?',
    ].join('\n');
    const data = parseFollowUp(source);
    expect(data.questions.map((q) => q.question)).toContain('Do we need pagination?');
    expect(data.questions.map((q) => q.question)).toContain('Which database?');
    expect(data.questions.some((q) => q.question === 'Should we ship it?')).toBe(true);
    expect(data.decisions).toEqual(['Use Postgres']);
    expect(data.openItems).toEqual(['[ ] Migrate data', 'Migrate data'].filter(Boolean).slice(0, 1));
    const database = data.questions.find((q) => q.question === 'Which database?')!;
    expect(database.options).toEqual(['Postgres 16', 'Postgres 15']);
    expect(hasFollowUpContent(data)).toBe(true);
  });

  it('ignores code blocks when scanning', () => {
    const data = parseFollowUp('```ts\n// Should we cache?\n```\nPlain text.');
    expect(data.questions).toHaveLength(0);
  });
});

describe('follow-up notes', () => {
  const data = {
    questions: [{ question: 'Which database?', options: ['Postgres', 'SQLite'] }],
    decisions: ['Use Postgres'],
    openItems: ['Update docs'],
  };

  it('builds a title from the first question', () => {
    expect(followUpTitle(data)).toBe('Follow-up: Which database?');
    expect(followUpTitle({ questions: [], decisions: [], openItems: [] })).toBe('Follow-up');
  });

  it('composes a note with Answer slots and options', () => {
    const body = composeFollowUpBody(data, 'Follow-up: Which database?');
    expect(body).toContain('- Which database?');
    expect(body).toContain('  - Answer: ');
    expect(body).toContain('  - [ ] Postgres');
    expect(body).toContain('## Decisions');
    expect(body).toContain('- [ ] Update docs');
  });

  it('reads answers back and composes the reply', () => {
    const body = [
      '# Follow-up',
      '',
      '## Questions',
      '',
      '- Which database?',
      '  - Answer: Postgres',
      '  - [ ] Postgres',
      '  - [ ] SQLite',
      '',
      '## Decisions',
      '',
      '- Use Postgres',
      '',
      '## Open items',
      '',
      '- [ ] Update docs',
      '',
    ].join('\n');
    const parsed = parseFollowUpNote(body);
    expect(parsed.questions[0].answer).toBe('Postgres');
    const reply = composeAnswersReply(body);
    expect(reply).toContain('- Which database? → Postgres');
    expect(reply).toContain('- Use Postgres');
    expect(reply).toContain('- Update docs');
  });

  it('validates AI inbox requests', () => {
    expect(parseFollowUpRequest(JSON.stringify({ version: 1, source: 'mcp', content: 'Answer' })).source).toBe('mcp');
    expect(() => parseFollowUpRequest('{"content":""}')).toThrow();
    expect(() =>
      parseFollowUpRequest(JSON.stringify({ content: 'x'.repeat(200_001) })),
    ).toThrow(/too large/);
  });
});
