import { describe, expect, it } from 'vitest';
import { terminalCommandFromLine, terminalCommandFromSelection } from '../../src/core/terminal';

describe('terminalCommandFromLine', () => {
  it('sends plain command lines unchanged', () => {
    expect(terminalCommandFromLine('npm test')).toEqual({ text: 'npm test' });
    expect(terminalCommandFromLine('  git status  ')).toEqual({ text: 'git status' });
  });

  it('strips list, task and ordered markers', () => {
    expect(terminalCommandFromLine('- npm run build')).toEqual({ text: 'npm run build' });
    expect(terminalCommandFromLine('* npm run lint')).toEqual({ text: 'npm run lint' });
    expect(terminalCommandFromLine('+ git pull')).toEqual({ text: 'git pull' });
    expect(terminalCommandFromLine('- [ ] npm test')).toEqual({ text: 'npm test' });
    expect(terminalCommandFromLine('* [x] npm run deploy')).toEqual({ text: 'npm run deploy' });
    expect(terminalCommandFromLine('1. npm ci')).toEqual({ text: 'npm ci' });
    expect(terminalCommandFromLine('2) docker compose up')).toEqual({ text: 'docker compose up' });
  });

  it('strips blockquotes and shell prompts', () => {
    expect(terminalCommandFromLine('> npm test')).toEqual({ text: 'npm test' });
    expect(terminalCommandFromLine('$ npm install')).toEqual({ text: 'npm install' });
    expect(terminalCommandFromLine('PS> Get-ChildItem')).toEqual({ text: 'Get-ChildItem' });
    expect(terminalCommandFromLine('❯ git log --oneline')).toEqual({ text: 'git log --oneline' });
    expect(terminalCommandFromLine('> - [ ] npm test')).toEqual({ text: 'npm test' });
  });

  it('unwraps a line that is a single inline code span', () => {
    expect(terminalCommandFromLine('`npm test -- --watch`')).toEqual({ text: 'npm test -- --watch' });
    expect(terminalCommandFromLine('- `git status --short`')).toEqual({ text: 'git status --short' });
    expect(terminalCommandFromLine('- [ ] `npm test`')).toEqual({ text: 'npm test' });
  });

  it('refuses headings, fences and empty lines', () => {
    expect(terminalCommandFromLine('## Run')).toEqual({ reason: 'heading' });
    expect(terminalCommandFromLine('# Title')).toEqual({ reason: 'heading' });
    expect(terminalCommandFromLine('```bash')).toEqual({ reason: 'fence' });
    expect(terminalCommandFromLine('~~~')).toEqual({ reason: 'fence' });
    expect(terminalCommandFromLine('   ')).toEqual({ reason: 'empty' });
    expect(terminalCommandFromLine('- [ ] ')).toEqual({ reason: 'empty' });
  });

  it('keeps shell syntax such as pipes, quotes and variables', () => {
    expect(terminalCommandFromLine('$ npm test | tee out.log')).toEqual({ text: 'npm test | tee out.log' });
    expect(terminalCommandFromLine('echo "hello world"')).toEqual({ text: 'echo "hello world"' });
    expect(terminalCommandFromLine('FOO=1 npm start')).toEqual({ text: 'FOO=1 npm start' });
    expect(terminalCommandFromLine('- rm -rf ./tmp # careful')).toEqual({ text: 'rm -rf ./tmp # careful' });
  });
});

describe('terminalCommandFromSelection', () => {
  it('keeps command lines and drops fences and blank lines', () => {
    const selection = ['```bash', 'npm ci', '', 'npm test', '```'].join('\n');
    expect(terminalCommandFromSelection(selection)).toBe('npm ci\nnpm test');
  });

  it('normalises list markers in a selection', () => {
    const selection = ['- npm ci', '- [ ] npm test', '## Not this', '> $ git status'].join('\n');
    expect(terminalCommandFromSelection(selection)).toBe('npm ci\nnpm test\ngit status');
  });

  it('handles CRLF and returns undefined for nothing usable', () => {
    expect(terminalCommandFromSelection('npm ci\r\nnpm test\r\n')).toBe('npm ci\nnpm test');
    expect(terminalCommandFromSelection('```\n\n```')).toBeUndefined();
    expect(terminalCommandFromSelection('   ')).toBeUndefined();
  });
});
