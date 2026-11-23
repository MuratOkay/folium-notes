---
template:
  name: Terminal Prompts
  description: Shell commands you can send to the integrated terminal line by line.
tags: [ terminal ]
---

# {{title}}

Send any line from this note to the integrated terminal with **Send Line to Terminal**
(Alt+N then Enter, the editor context menu, or the Command Palette). List markers, blockquotes
and `$` prompts are removed first; headings and code fence lines are ignored.

## Install

```bash
npm ci
```

## Build and test

```bash
npm run build
npm test
```

## Useful commands

- npm run lint
- `git status --short`
- $ npm outdated

{{cursor}}
