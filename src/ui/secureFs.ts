/** `folium-secure:` virtual filesystem: encrypted notes open decrypted in the editor. */

import * as vscode from 'vscode';
import fs from 'node:fs/promises';
import { decryptNote, encryptNote, unwrapEncryptedBody } from '../core/crypto';
import { parseNote } from '../core/frontmatter';
import type { KeyManager } from './keys';

export const SECURE_SCHEME = 'folium-secure';

const encodePath = (absPath: string): string => Buffer.from(absPath, 'utf8').toString('base64url');
const decodePath = (uriPath: string): string =>
  Buffer.from(uriPath.replace(/^\//, ''), 'base64url').toString('utf8');

export function secureUri(absPath: string): vscode.Uri {
  return vscode.Uri.from({ scheme: SECURE_SCHEME, path: `/${encodePath(absPath)}` });
}

export function secureTargetPath(uri: vscode.Uri): string {
  return decodePath(uri.path);
}

export function isSecureUri(uri: vscode.Uri): boolean {
  return uri.scheme === SECURE_SCHEME;
}

export class SecureFileSystem implements vscode.FileSystemProvider {
  private readonly changes = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
  readonly onDidChangeFile = this.changes.event;

  constructor(
    private readonly keys: KeyManager,
    private readonly onError: (message: string) => void,
  ) {}

  watch(): vscode.Disposable {
    return { dispose: () => undefined };
  }

  async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
    const stat = await fs.stat(secureTargetPath(uri));
    return { type: vscode.FileType.File, ctime: stat.ctimeMs, mtime: stat.mtimeMs, size: stat.size };
  }

  async readFile(uri: vscode.Uri): Promise<Uint8Array> {
    const target = secureTargetPath(uri);
    const key = await this.keys.get();
    const raw = await fs.readFile(target, 'utf8');
    if (unwrapEncryptedBody(parseNote(raw).body) === undefined) {
      return Buffer.from(raw, 'utf8');
    }
    if (!key) {
      const message = 'Folium Notes: the encryption key for this note is missing. Restore it with "Folium: Restore Encryption Key".';
      this.onError(message);
      throw vscode.FileSystemError.Unavailable(message);
    }
    try {
      const plain = decryptNote(raw, key);
      return Buffer.from(plain, 'utf8');
    } catch (error) {
      const message = `Folium Notes: could not decrypt this note (${error instanceof Error ? error.message : String(error)}).`;
      this.onError(message);
      throw vscode.FileSystemError.Unavailable(message);
    }
  }

  async writeFile(uri: vscode.Uri, content: Uint8Array): Promise<void> {
    const target = secureTargetPath(uri);
    const key = await this.keys.ensure();
    const plain = Buffer.from(content).toString('utf8');
    const encrypted = encryptNote(plain, key);
    await fs.writeFile(target, encrypted, 'utf8');
    this.changes.fire([{ type: vscode.FileChangeType.Changed, uri }]);
  }

  async delete(uri: vscode.Uri): Promise<void> {
    throw vscode.FileSystemError.NoPermissions('Encrypted notes cannot be deleted from the editor. Use "Folium: Delete Note".');
  }

  async rename(uri: vscode.Uri): Promise<void> {
    throw vscode.FileSystemError.NoPermissions('Encrypted notes cannot be renamed from the editor.');
  }

  async createDirectory(): Promise<void> {
    throw vscode.FileSystemError.NoPermissions('Not supported');
  }

  async readDirectory(): Promise<Array<[string, vscode.FileType]>> {
    return [];
  }
}
