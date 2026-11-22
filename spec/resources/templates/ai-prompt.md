---
template:
  name: AI prompt
  description: "A prompt with selection, file and language context."
  sharedOnly: true
tags: [ ai ]
kind: prompt
---

# {{title}}

## Task

## Context

File: {{file}}
Language: {{language}}

```{{language}}
{{selection}}
```

## Constraints

{{cursor}}
