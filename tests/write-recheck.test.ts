import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { persistRecheck, persistRecheckFlag, queryWriteResult, readRecheck, readRecheckFlag, versionedWriteOutcome } from '../src/client/core/write-recheck';

describe('pending write receipts', () => {
  let entries: Map<string, string>;
  beforeEach(() => {
    entries = new Map();
    vi.stubGlobal('sessionStorage', { getItem: (key: string) => entries.get(key) ?? null, setItem: (key: string, value: string) => entries.set(key, value), removeItem: (key: string) => entries.delete(key) });
  });
  afterEach(() => vi.unstubAllGlobals());
  const decode = (value: unknown) => value && typeof value === 'object' && 'version' in value ? value : null;
  it('round-trips original requests and isolates account/project keys', () => {
    const original = { version: 2, body: { title: '原输入' }, stage: 'read' };
    persistRecheck('account:a:project:p', original);
    expect(readRecheck('account:a:project:p', decode)).toEqual(original);
    expect(readRecheck('account:b:project:p', decode)).toBeNull();
    persistRecheck('account:a:project:p', null);
    expect(entries.size).toBe(0);
  });
  it('keeps historical flag storage compatible', () => {
    entries.set('flag', '1');
    expect(readRecheckFlag('flag')).toBe(true);
    persistRecheckFlag('flag', false);
    expect(entries.has('flag')).toBe(false);
    persistRecheckFlag('flag', true);
    expect(entries.get('flag')).toBe('1');
  });
  it('contains malformed JSON, invalid payload and storage failures', () => {
    entries.set('bad', '{');
    expect(readRecheck('bad', decode)).toBeNull();
    entries.set('bad', '"text"');
    expect(readRecheck('bad', decode)).toBeNull();
    vi.stubGlobal('sessionStorage', { getItem: () => { throw Error('disabled'); }, setItem: () => { throw Error('quota'); } });
    expect(readRecheck('x', decode)).toBeNull();
    expect(() => persistRecheck('x', { version: 1 })).not.toThrow();
  });
  it('distinguishes applied, not applied and conflicting writes without resending', async () => {
    const request = { version: 1 };
    const read = vi.fn(async () => ({ version: 2 }));
    const checked = await queryWriteResult(request, read, (original, latest) => versionedWriteOutcome(original.version, latest.version));
    expect(checked.outcome).toBe('conflict');
    expect(read).toHaveBeenCalledTimes(1);
    expect(versionedWriteOutcome(1, 1)).toBe('not-applied');
    expect(versionedWriteOutcome(1, 2, true)).toBe('applied');
    expect(request).toEqual({ version: 1 });
  });
  it('preserves the receipt after an inaccessible or unknown read', async () => {
    persistRecheck('pending', { version: 1 });
    for (const error of [Error('404'), Error('network')]) {
      await expect(queryWriteResult({ version: 1 }, () => Promise.reject(error), () => 'applied')).rejects.toBe(error);
      expect(readRecheck('pending', decode)).toEqual({ version: 1 });
    }
  });
});
