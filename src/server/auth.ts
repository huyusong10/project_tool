import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { config } from './config';

export type Actor = { type: 'user' | 'token'; id: string; label: string };

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

function sessionSignature(value: string) {
  return createHmac('sha256', config.sessionSecret).update(value).digest('base64url');
}

export function createSessionToken(username: string) {
  const expiresAt = Date.now() + config.sessionHours * 60 * 60 * 1000;
  const value = Buffer.from(JSON.stringify({ username, expiresAt })).toString('base64url');
  return `${value}.${sessionSignature(value)}`;
}

export function verifySessionToken(token?: string): { username: string; expiresAt: number } | null {
  if (!token || !config.sessionSecret) return null;
  const [value, signature] = token.split('.');
  if (!value || !signature) return null;
  const expected = Buffer.from(sessionSignature(value));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  try {
    const payload = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as { username: string; expiresAt: number };
    if (payload.username !== config.appUsername || payload.expiresAt <= Date.now()) return null;
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
