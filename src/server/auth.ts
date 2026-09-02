import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { config } from './config';

export type AccountRole = 'user' | 'admin';
export type Actor = {
  type: 'user' | 'token';
  id: string;
  label: string;
  accountId?: string;
  personId?: string | null;
  globalRole?: AccountRole;
};

export function hashPassword(password: string, salt = randomBytes(16).toString('hex')): string {
  const derived = scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${derived}`;
}

export function verifyPassword(password: string, encoded: string): boolean {
  const [algorithm, salt, expectedHex] = encoded.split('$');
  if (algorithm !== 'scrypt' || !salt || !expectedHex) return false;
  const actual = scryptSync(password, salt, 64);
  const expected = Buffer.from(expectedHex, 'hex');
  return expected.length === actual.length && timingSafeEqual(actual, expected);
}

export function normalizeUsername(username: string) {
  return username.trim().toLocaleLowerCase('zh-CN');
}

function sessionSignature(value: string) {
  return createHmac('sha256', config.sessionSecret).update(value).digest('base64url');
}

export function createSessionToken(accountId: string, sessionVersion: number) {
  const expiresAt = Date.now() + config.sessionHours * 60 * 60 * 1000;
  const value = Buffer.from(JSON.stringify({ accountId, sessionVersion, expiresAt })).toString('base64url');
  return `${value}.${sessionSignature(value)}`;
}

export function verifySessionToken(token?: string): { accountId: string; sessionVersion: number; expiresAt: number } | null {
  if (!token || !config.sessionSecret) return null;
  const [value, signature] = token.split('.');
  if (!value || !signature) return null;
  const expected = Buffer.from(sessionSignature(value));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  try {
    const payload = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as { accountId: string; sessionVersion: number; expiresAt: number };
    if (!payload.accountId || !Number.isInteger(payload.sessionVersion) || payload.expiresAt <= Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export function hashApiToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

export function createApiTokenValue() {
  const prefix = randomBytes(5).toString('hex');
  const secret = randomBytes(32).toString('base64url');
  return { prefix, token: `pm_${prefix}_${secret}` };
}
