import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { jiraEncryptionKey } from '../src/server/jira/encryption-key';
import { jiraSetupMessages } from '../src/shared/jira';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-jira-key-'));
afterAll(() => fs.rmSync(directory, { recursive: true, force: true }));

describe('automatic Jira storage key', () => {
  it('creates a random key on first use and reuses its persisted value', () => {
    const settings = { dbPath: path.join(directory, 'new', 'app.db'), jiraEncryptionKey: '' };
    const first = jiraEncryptionKey(settings);
    expect(first.length).toBe(32);
    expect(fs.readFileSync(`${settings.dbPath}.jira-key`, 'utf8')).toBe(first.toString('hex'));
    expect(jiraEncryptionKey({ ...settings })).toEqual(first);
    if (process.platform !== 'win32') expect(fs.statSync(`${settings.dbPath}.jira-key`).mode & 0o777).toBe(0o600);
    expect(jiraEncryptionKey({ ...settings, dbPath: path.join(directory, 'other.db') })).not.toEqual(first);
  });

  it('preserves the explicit environment key without writing a file', () => {
    const settings = { dbPath: path.join(directory, 'explicit.db'), jiraEncryptionKey: 'a'.repeat(64) };
    expect(jiraEncryptionKey(settings)).toEqual(Buffer.from(settings.jiraEncryptionKey, 'hex'));
    expect(fs.existsSync(`${settings.dbPath}.jira-key`)).toBe(false);
  });

  it('never overwrites an existing key, even when an environment override is used', () => {
    const settings = { dbPath: path.join(directory, 'override.db'), jiraEncryptionKey: '' };
    const original = jiraEncryptionKey(settings);
    expect(jiraEncryptionKey({ ...settings, jiraEncryptionKey: 'b'.repeat(64) })).toEqual(Buffer.from('b'.repeat(64), 'hex'));
    expect(jiraEncryptionKey(settings)).toEqual(original);
  });

  it('does not replace damaged keys or silently ignore invalid explicit configuration', () => {
    const settings = { dbPath: path.join(directory, 'damaged.db'), jiraEncryptionKey: '' };
    fs.writeFileSync(`${settings.dbPath}.jira-key`, 'damaged');
    expect(() => jiraEncryptionKey(settings)).toThrow(jiraSetupMessages.deployment);
    expect(fs.readFileSync(`${settings.dbPath}.jira-key`, 'utf8')).toBe('damaged');
    const explicit = { dbPath: path.join(directory, 'invalid.db'), jiraEncryptionKey: 'bad-explicit-key' };
    expect(() => jiraEncryptionKey(explicit)).toThrow(jiraSetupMessages.deployment);
    expect(fs.existsSync(`${explicit.dbPath}.jira-key`)).toBe(false);
  });

  it('returns a user-facing error when the key cannot be stored', () => {
    const parentFile = path.join(directory, 'not-a-directory');
    fs.writeFileSync(parentFile, 'file');
    expect(() => jiraEncryptionKey({ dbPath: path.join(parentFile, 'app.db'), jiraEncryptionKey: '' })).toThrow(jiraSetupMessages.deployment);
  });
});
