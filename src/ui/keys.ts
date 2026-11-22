/** Encryption key storage in VS Code SecretStorage. */

import * as vscode from 'vscode';
import {
  encryptNote,
  generateKey,
  keyFromText,
  keyToText,
  formatKeyBackup,
  parseKeyBackup,
  fingerprint,
} from '../core/crypto';

export const SECRET_KEY = 'folium.encryptionKey';

export class KeyManager {
  private cached?: Buffer;

  constructor(private readonly secrets: vscode.SecretStorage) {}

  async get(): Promise<Buffer | undefined> {
    if (this.cached) return this.cached;
    const stored = await this.secrets.get(SECRET_KEY);
    if (!stored) return undefined;
    try {
      this.cached = keyFromText(stored);
      return this.cached;
    } catch {
      return undefined;
    }
  }

  /** Get the key, creating and storing one when missing. */
  async ensure(): Promise<Buffer> {
    const existing = await this.get();
    if (existing) return existing;
    const key = generateKey();
    await this.storeKey(key);
    return key;
  }

  async has(): Promise<boolean> {
    return (await this.get()) !== undefined;
  }

  async fingerprint(): Promise<string | undefined> {
    const key = await this.get();
    return key ? fingerprint(key) : undefined;
  }

  async storeKey(key: Buffer): Promise<void> {
    await this.secrets.store(SECRET_KEY, keyToText(key));
    this.cached = key;
  }

  async backupText(): Promise<string> {
    const key = await this.ensure();
    return formatKeyBackup(key);
  }

  async restoreFromText(text: string): Promise<string> {
    const key = parseKeyBackup(text);
    await this.storeKey(key);
    return fingerprint(key);
  }

  async forget(): Promise<void> {
    this.cached = undefined;
    await this.secrets.delete(SECRET_KEY);
  }

  /** Encrypt a note for storage in place. */
  async encrypt(raw: string): Promise<string> {
    return encryptNote(raw, await this.ensure());
  }
}
