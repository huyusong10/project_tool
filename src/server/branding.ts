import { getDatabaseContext } from './database-context';
import { AppError, fail } from './errors';
import { nextUpdatedAt } from './services/support';
import { canonicalizeLabel, textSafetyIssue } from '../shared/search';
import type { Actor } from './auth';
import { assertAdmin, requireAuthorizationActor } from './authorization';
import { recordAudit } from './services/audit';

const BRANDING_META_KEY = 'system-branding';
const DEFAULT_SYSTEM_NAME = '项目管理';
const DEFAULT_SHORT_NAME = 'PM';
const MAX_LOGO_BYTES = 512 * 1024;

type StoredBranding = {
  systemName: string;
  shortName: string;
  logoMimeType: string | null;
  logoBase64: string | null;
};

type BrandingRow = {
  value: string;
  updatedAt: string;
};

function characterCount(value: string) {
  return [...value].length;
}

function brandingRow() {
  return getDatabaseContext().sqlite.prepare('SELECT value, updated_at AS updatedAt FROM system_meta WHERE key=?')
    .get(BRANDING_META_KEY) as BrandingRow | undefined;
}

function defaultStoredBranding(): StoredBranding {
  return {
    systemName: DEFAULT_SYSTEM_NAME,
    shortName: DEFAULT_SHORT_NAME,
    logoMimeType: null,
    logoBase64: null,
  };
}

function readStoredBranding(row = brandingRow()): { value: StoredBranding; updatedAt: string | null } {
  if (!row) return { value: defaultStoredBranding(), updatedAt: null };
  try {
    const parsed = JSON.parse(row.value) as Partial<StoredBranding>;
    const systemName = canonicalizeLabel(parsed.systemName);
    const shortName = canonicalizeLabel(parsed.shortName);
    if (!systemName || !shortName) throw new Error('invalid branding');
    return {
      value: {
        systemName,
        shortName,
        logoMimeType: parsed.logoMimeType || null,
        logoBase64: parsed.logoBase64 || null,
      },
      updatedAt: row.updatedAt,
    };
  } catch {
    // 即使历史值损坏，也保留真实版本，管理员保存默认值时仍需通过并发校验。
    return { value: defaultStoredBranding(), updatedAt: row.updatedAt };
  }
}

function publicBranding(value: StoredBranding, updatedAt: string | null) {
  return {
    systemName: value.systemName,
    shortName: value.shortName,
    logoUrl: value.logoBase64 && value.logoMimeType
      ? `/api/branding/logo?v=${encodeURIComponent(updatedAt || 'default')}`
      : null,
    updatedAt,
  };
}

function detectImageMime(buffer: Buffer) {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  return null;
}

function parseLogoDataUrl(value: unknown) {
  if (value === null) return { mimeType: null, base64: null };
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([a-zA-Z0-9+/=]+)$/.exec(String(value || ''));
  if (!match) fail('Logo仅支持PNG、JPEG或WebP图片');
  const buffer = Buffer.from(match[2], 'base64');
  if (!buffer.length || buffer.length > MAX_LOGO_BYTES) fail('Logo文件不能超过512KB');
  const detectedMime = detectImageMime(buffer);
  if (!detectedMime || detectedMime !== match[1]) fail('Logo文件内容与图片格式不一致');
  return { mimeType: detectedMime, base64: buffer.toString('base64') };
}

export function getBranding() {
  const stored = readStoredBranding();
  return publicBranding(stored.value, stored.updatedAt);
}

export function getBrandingLogo() {
  const stored = readStoredBranding();
  if (!stored.value.logoBase64 || !stored.value.logoMimeType) return null;
  return {
    content: Buffer.from(stored.value.logoBase64, 'base64'),
    mimeType: stored.value.logoMimeType,
    updatedAt: stored.updatedAt,
  };
}

export function updateBranding(input: Record<string, unknown>, actor: Actor) {
  return getDatabaseContext().sqlite.transaction(() => updateBrandingInTransaction(input, actor))();
}

function updateBrandingInTransaction(input: Record<string, unknown>, actor: Actor) {
  if (Object.keys(input).some((key) => !['systemName', 'shortName', 'logoDataUrl', 'expectedUpdatedAt'].includes(key))) {
    fail('品牌设置不能提交未声明字段');
  }
  if (textSafetyIssue(input.systemName, false) || textSafetyIssue(input.shortName, false)) fail('系统名称包含不支持的控制字符');
  const systemName = canonicalizeLabel(input.systemName);
  const shortName = canonicalizeLabel(input.shortName);
  if (!systemName || characterCount(systemName) > 20) fail('系统名称需为1～20个字符');
  if (!shortName || characterCount(shortName) > 4) fail('系统简称需为1～4个字符');

  const existing = brandingRow();
  const currentUpdatedAt = existing?.updatedAt || null;
  if (Object.prototype.hasOwnProperty.call(input, 'expectedUpdatedAt') && input.expectedUpdatedAt !== currentUpdatedAt) {
    throw new AppError('品牌设置已被其他管理员修改，请刷新后重试', 409, 'STALE_WRITE', { currentUpdatedAt });
  }
  const current = readStoredBranding(existing).value;
  let logoMimeType = current.logoMimeType;
  let logoBase64 = current.logoBase64;
  if (Object.prototype.hasOwnProperty.call(input, 'logoDataUrl')) {
    const logo = parseLogoDataUrl(input.logoDataUrl);
    logoMimeType = logo.mimeType;
    logoBase64 = logo.base64;
  }

  const value: StoredBranding = { systemName, shortName, logoMimeType, logoBase64 };
  const serialized = JSON.stringify(value);
  const unchanged = existing
    ? existing.value === serialized
    : JSON.stringify(current) === serialized;
  if (unchanged) {
    assertAdmin(requireAuthorizationActor(actor));
    return publicBranding(current, currentUpdatedAt);
  }
  const now = currentUpdatedAt ? nextUpdatedAt(currentUpdatedAt) : new Date().toISOString();
  const changed = existing
    ? getDatabaseContext().sqlite.prepare('UPDATE system_meta SET value=?, updated_at=? WHERE key=? AND updated_at=?')
      .run(serialized, now, BRANDING_META_KEY, existing.updatedAt)
    : getDatabaseContext().sqlite.prepare('INSERT OR IGNORE INTO system_meta (key, value, created_at, updated_at) VALUES (?, ?, ?, ?)')
      .run(BRANDING_META_KEY, serialized, now, now);
  if (!changed.changes) {
    const latestUpdatedAt = brandingRow()?.updatedAt || null;
    throw new AppError('品牌设置已被其他管理员修改，请刷新后重试', 409, 'STALE_WRITE', { currentUpdatedAt: latestUpdatedAt });
  }
  assertAdmin(requireAuthorizationActor(actor));
  const result = publicBranding(value, now);
  recordAudit(actor, 'update', 'system_branding', 'default', `更新系统品牌：${result.systemName}（${result.shortName}）`);
  return result;
}
