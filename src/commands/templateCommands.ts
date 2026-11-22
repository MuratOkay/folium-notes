/** Template commands: use, create, save, manage and preview templates. */

import * as vscode from 'vscode';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { FoliumApp } from '../app';
import { confirmDanger } from './util';
import { createNoteFlow } from './noteCommands';
import {
  renderTemplate,
  sampleContext,
  templateFileContent,
  templatesForScope,
  type TemplateDefinition,
} from '../core/templates';
import { parseNote } from '../core/frontmatter';
import { slugify } from '../core/filenames';

async function pickTemplate(
  app: FoliumApp,
  placeHolder = 'Pick a template',
): Promise<TemplateDefinition | undefined> {
  const store = app.store;
  if (!store) return undefined;
  const templates = store.templates;
  const picked = await vscode.window.showQuickPick(
    templates.map((template) => ({
      label: template.name,
      description: template.builtin
        ? 'built-in'
        : template.sourcePath?.includes('.templates') && template.sourcePath.includes(path.sep)
          ? template.sourcePath.split(path.sep).includes('.templates')
            ? template.sourcePath.includes(store.paths.teamTemplatesDir)
              ? 'team'
              : 'mine'
            : 'custom'
          : 'custom',
      detail: template.description,
      template,
    })),
    { placeHolder, matchOnDescription: true, matchOnDetail: true },
  );
  return picked?.template;
}

export async function newFromTemplate(app: FoliumApp): Promise<void> {
  const template = await pickTemplate(app, 'New note from template');
  if (!template) return;
  const scope = template.privateOnly ? 'private' : template.sharedOnly ? 'shared' : undefined;
  await createNoteFlow(app, { templateName: template.name, scope });
}

export async function createTemplate(app: FoliumApp): Promise<void> {
  const store = app.store;
  if (!store) return;
  const target = await vscode.window.showQuickPick(
    [
      { label: 'Personal template', description: 'in your private folder (~/FoliumNotes/.templates)', value: 'personal' as const },
      { label: 'Team template', description: 'in the shared folder (.notes/.templates), committed', value: 'team' as const },
    ],
    { placeHolder: 'Where should the template live?' },
  );
  if (!target) return;
  const name = await vscode.window.showInputBox({ prompt: 'Template name', validateInput: (value) => (value.trim() ? undefined : 'Name required') });
  if (!name) return;
  const description = await vscode.window.showInputBox({ prompt: 'Description (optional)' });
  const file = await store.writeTemplate(target.value, {
    name: name.trim(),
    description: description?.trim() || undefined,
    body: `# {{title}}\n\n{{cursor}}\n`,
  });
  await vscode.window.showTextDocument(vscode.Uri.file(file));
  app.refresh();
}

export async function saveNoteAsTemplate(app: FoliumApp): Promise<void> {
  const store = app.store;
  const editor = vscode.window.activeTextEditor;
  if (!store || !editor) {
    void vscode.window.showWarningMessage('Folium Notes: open a note first.');
    return;
  }
  const note = store.byPath(editor.document.uri.fsPath);
  if (!note) {
    void vscode.window.showWarningMessage('Folium Notes: open a note first.');
    return;
  }
  const target = await vscode.window.showQuickPick(
    [
      { label: 'Personal template', value: 'personal' as const },
      { label: 'Team template (committed)', value: 'team' as const },
    ],
    { placeHolder: 'Save as which kind of template?' },
  );
  if (!target) return;
  const name = await vscode.window.showInputBox({ prompt: 'Template name', value: note.title });
  if (!name) return;
  const description = await vscode.window.showInputBox({ prompt: 'Description (optional)' });
  const file = await store.writeTemplate(target.value, {
    name: name.trim(),
    description: description?.trim() || undefined,
    scope: note.scope,
    sensitive: note.sensitive,
    kind: note.kind,
    promptTarget: note.target,
    tags: note.tags,
    color: note.color,
    body: note.body,
  });
  void vscode.window.showInformationMessage(`Folium: saved template "${name}".`);
  app.refresh();
  await vscode.window.showTextDocument(vscode.Uri.file(file), { preview: true });
}

async function rewriteTemplate(
  template: TemplateDefinition,
  changes: { name?: string; description?: string },
): Promise<string | undefined> {
  if (!template.sourcePath) return undefined;
  const raw = await fs.readFile(template.sourcePath, 'utf8');
  const parsed = parseNote(raw);
  const content = templateFileContent({
    name: changes.name ?? template.name,
    description: changes.description ?? template.description,
    scope: template.scope,
    privateOnly: template.privateOnly,
    sharedOnly: template.sharedOnly,
    sensitive: template.sensitive,
    kind: template.kind,
    target: template.target,
    tags: template.tags,
    color: template.color,
    body: parsed.body.replace(/^\n+/, ''),
  });
  const dir = path.dirname(template.sourcePath);
  const newName = changes.name ? `${slugify(changes.name) || 'template'}.md` : path.basename(template.sourcePath);
  const target = path.join(dir, newName);
  await fs.writeFile(target, content, 'utf8');
  if (target !== template.sourcePath) await fs.unlink(template.sourcePath).catch(() => undefined);
  return target;
}

export async function manageTemplates(app: FoliumApp): Promise<void> {
  const store = app.store;
  if (!store) return;
  for (;;) {
    const template = await pickTemplate(app, 'Manage templates');
    if (!template) return;
    const actions = [
      { label: '$(add) New note from template', value: 'new' },
      { label: '$(preview) Preview', value: 'preview' },
      { label: '$(edit) Edit', value: 'edit' },
      { label: '$(edit) Rename', value: 'rename' },
      { label: '$(copy) Copy to my templates', value: 'copy-personal' },
      { label: '$(copy) Copy to team templates', value: 'copy-team' },
      ...(template.builtin ? [{ label: '$(wrench) Customize (copy built-in)', value: 'customize' }] : []),
      ...(template.builtin ? [] : [{ label: '$(trash) Delete', value: 'delete' }]),
    ];
    const action = await vscode.window.showQuickPick(actions, { placeHolder: template.name });
    if (!action) return;
    switch (action.value) {
      case 'new':
        await createNoteFlow(app, {
          templateName: template.name,
          scope: template.privateOnly ? 'private' : template.sharedOnly ? 'shared' : undefined,
        });
        return;
      case 'preview':
        await previewTemplate(app, template);
        break;
      case 'edit': {
        let source = template;
        if (template.builtin) {
          const copied = await copyTemplate(app, template, await pickTarget());
          if (!copied) return;
          source = copied;
        }
        if (source.sourcePath) await vscode.window.showTextDocument(vscode.Uri.file(source.sourcePath));
        return;
      }
      case 'rename': {
        if (template.builtin) {
          void vscode.window.showInformationMessage('Folium: customize the built-in template before renaming it.');
          break;
        }
        const name = await vscode.window.showInputBox({ prompt: 'New template name', value: template.name });
        if (!name) break;
        await rewriteTemplate(template, { name: name.trim() });
        await store.reloadTemplates();
        app.refresh();
        break;
      }
      case 'copy-personal':
      case 'copy-team':
        await copyTemplate(app, template, action.value === 'copy-team' ? 'team' : 'personal');
        break;
      case 'customize':
        await copyTemplate(app, template, await pickTarget());
        break;
      case 'delete': {
        if (!template.sourcePath) break;
        const ok = await confirmDanger(`Delete template "${template.name}"?`, 'Delete');
        if (!ok) break;
        await fs.unlink(template.sourcePath).catch(() => undefined);
        await store.reloadTemplates();
        app.refresh();
        break;
      }
    }
  }
}

async function pickTarget(): Promise<'team' | 'personal'> {
  const picked = await vscode.window.showQuickPick(
    [
      { label: 'Personal template', value: 'personal' as const },
      { label: 'Team template', value: 'team' as const },
    ],
    { placeHolder: 'Copy to' },
  );
  return picked?.value ?? 'personal';
}

async function copyTemplate(
  app: FoliumApp,
  template: TemplateDefinition,
  target: 'team' | 'personal',
): Promise<TemplateDefinition | undefined> {
  const store = app.store;
  if (!store) return undefined;
  const dir = store.templateDirFor(target);
  await fs.mkdir(dir, { recursive: true });
  let fileName = `${slugify(template.name) || 'template'}.md`;
  let counter = 2;
  while (await fs.stat(path.join(dir, fileName)).catch(() => undefined)) {
    fileName = `${slugify(template.name) || 'template'}-${counter}.md`;
    counter++;
  }
  const content = templateFileContent({
    name: template.name,
    description: template.description,
    scope: template.scope,
    privateOnly: template.privateOnly,
    sharedOnly: template.sharedOnly,
    sensitive: template.sensitive,
    kind: template.kind,
    target: template.target,
    tags: template.tags,
    color: template.color,
    body: template.body,
  });
  await fs.writeFile(path.join(dir, fileName), content, 'utf8');
  const templates = await store.reloadTemplates();
  app.refresh();
  void vscode.window.showInformationMessage(`Folium: copied "${template.name}" to ${target} templates.`);
  return templates.find((candidate) => candidate.name === template.name && candidate.sourcePath?.startsWith(dir));
}

export async function previewTemplate(app: FoliumApp, template?: TemplateDefinition): Promise<void> {
  const picked = template ?? (await pickTemplate(app));
  if (!picked) return;
  const rendered = renderTemplate(picked.body, sampleContext());
  const document = await vscode.workspace.openTextDocument({
    content: `# Preview: ${picked.name}\n\n${rendered.text}`,
    language: 'markdown',
  });
  await vscode.window.showTextDocument(document, { preview: true, viewColumn: vscode.ViewColumn.Beside });
  await vscode.commands.executeCommand('markdown.showPreviewToSide', document.uri);
}

export async function browseTemplatesForScope(app: FoliumApp): Promise<void> {
  const store = app.store;
  if (!store) return;
  const scope = await vscode.window.showQuickPick(
    [
      { label: 'Shared notes', value: 'shared' as const },
      { label: 'Private notes', value: 'private' as const },
    ],
    { placeHolder: 'Templates for which scope?' },
  );
  if (!scope) return;
  const templates = templatesForScope(store.templates, scope.value);
  const picked = await vscode.window.showQuickPick(
    templates.map((candidate) => ({
      label: candidate.name,
      description: candidate.description,
      detail: candidate.builtin ? 'built-in' : candidate.sourcePath,
      candidate,
    })),
    { placeHolder: 'New note from template' },
  );
  if (!picked) return;
  await createNoteFlow(app, { scope: scope.value, templateName: picked.candidate.name });
}
