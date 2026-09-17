import fs from 'node:fs';
import path from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';
import pino from 'pino';
import dotenv from 'dotenv';

dotenv.config({ quiet: true });
const context = new AsyncLocalStorage();
const loggedErrors = new WeakSet();
const levels = ['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent'];
const fields = ['user', 'accountId', 'actorType', 'authMethod', 'accessMode', 'sourceIp', 'tokenName', 'tokenId', 'attemptedUser',
  'projectName', 'projectId', 'resourceType', 'resourceId', 'requirementId', 'workItemId', 'featureId', 'phaseId',
  'fields', 'reason', 'reasonCode', 'validationFields', 'expectedVersion', 'currentVersion',
  'reqId', 'durationMs', 'statusCode', 'errorCode', 'tool', 'mcpMethod', 'method', 'route',
  'outcome', 'url', 'version', 'logDir', 'logLevel', 'signal', 'exitCode', 'operationId',
  'backupName', 'dataset', 'panelId', 'slow', 'role'];
const pad = (value, width = 2) => String(value).padStart(width, '0');
const localDay = date => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

export function readLogConfig(env = process.env) {
  const positive = (value, fallback) => Number.isInteger(Number(value)) && Number(value) > 0 ? Number(value) : fallback;
  return {
    level: levels.includes(env.LOG_LEVEL) ? env.LOG_LEVEL : 'info',
    format: ['auto', 'text', 'json'].includes(env.LOG_FORMAT) ? env.LOG_FORMAT : 'auto',
    directory: path.resolve(env.LOG_DIR || './data/logs'),
    retentionDays: positive(env.LOG_RETENTION_DAYS, 14),
    fileEnabled: env.LOG_FILE_ENABLED === undefined ? env.NODE_ENV !== 'test' : !['0', 'false'].includes(env.LOG_FILE_ENABLED),
    slowMs: positive(env.LOG_SLOW_MS, 1000),
  };
}

export function runWithLogContext(bindings, callback) { return context.run(bindings, callback); }
export function updateLogContext(bindings) { const current = context.getStore(); if (current) Object.assign(current, bindings); }
export function readLogContext() { return { ...context.getStore() }; }
export function errorWasLogged(error) { return !!error && typeof error === 'object' && loggedErrors.has(error); }

function localTime(time) {
  const date = new Date(time);
  const offset = -date.getTimezoneOffset();
  return `${localDay(date)} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}${offset >= 0 ? '+' : '-'}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`;
}

export function createRuntimeLogger(options = {}) {
  const settings = { ...readLogConfig(), ...options };
  const stdout = options.stdout || process.stdout, stderr = options.stderr || process.stderr;
  const now = options.now || (() => new Date());
  const role = options.role === 'launcher' ? 'launcher' : 'server';
  const pid = options.pid || process.pid;
  const secrets = [...(options.secrets || []), process.env.ADMIN_PASSWORD, process.env.APP_PASSWORD_HASH, process.env.SESSION_SECRET].filter(Boolean);
  const clean = value => {
    let text = String(value);
    for (const secret of secrets) text = text.split(secret).join('[REDACTED]');
    return text.replace(/Bearer\s+[^\s"',;]+/gi, 'Bearer [REDACTED]')
      .replace(/pm_[a-f0-9]{10}_[A-Za-z0-9_-]+/g, '[REDACTED]')
      .replace(/((?:password|token|secret|cookie|authorization)["']?\s*[:=]\s*)(?:"[^"\n]*"|'[^'\n]*'|[^\s,;]+)/gi, '$1[REDACTED]');
  };
  const streams = new Set();
  let current, day, fileFailed = false, cleanupFailed = false, closed = false;
  let closing;
  const consoleStreams = new Set([stdout, stderr]);
  const ignoreConsoleError = () => {};
  for (const stream of consoleStreams) stream.on('error', ignoreConsoleError);

  function terminal(record) {
    const destination = ['warn', 'error', 'fatal'].includes(record.level) ? stderr : stdout;
    const textMode = settings.format === 'text' || (settings.format === 'auto' && destination.isTTY);
    let line;
    if (textMode) {
      const displayFields = record.event === 'server.started' ? ['pid', ...fields] : fields;
      const formatValue = value => {
        const text = String(value);
        return /[\s"=\\\x00-\x1f\x7f\u2028\u2029]/.test(text) ? JSON.stringify(text).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029') : text;
      };
      const details = displayFields.filter(key => record[key] !== undefined && key !== 'role').map(key =>
        `${key === 'durationMs' ? 'duration' : key}=${formatValue(record[key])}${key === 'durationMs' ? 'ms' : ''}`);
      if (record.err) details.push(`error=${formatValue(record.err.message)}`);
      if (record.err?.stack) details.push(`stack=${formatValue(record.err.stack)}`);
      const extras = details.join(' ');
      let level = record.level.toUpperCase().padEnd(5);
      if (destination.isTTY && !process.env.NO_COLOR) {
        const color = { trace: 90, debug: 90, info: 32, warn: 33, error: 31, fatal: 35 }[record.level];
        level = `\x1b[${color}m${level}\x1b[0m`;
      }
      line = `${localTime(record.time)} ${level} [${record.module}] ${record.msg.replace(/[\x00-\x1f\x7f\x85\u2028\u2029]/g, ' ')}${extras ? ' ' + extras : ''}\n`;
    } else line = JSON.stringify(record) + '\n';
    try { destination.write(line); } catch { /* A closed console must not stop the service. */ }
  }

  function fileError(error) {
    if (fileFailed) return;
    fileFailed = true;
    for (const stream of streams) stream.destroy();
    terminal({ time: now().toISOString(), level: 'error', module: 'logger', event: 'logger.file_failed',
      msg: '日志文件无法写入，本进程改为仅输出终端日志', pid, errorCode: error?.code || 'LOG_FILE_ERROR' });
  }

  function rotate(date) {
    const nextDay = localDay(date);
    if (day === nextDay) return;
    fs.mkdirSync(settings.directory, { recursive: true });
    const cutoff = new Date(date);
    cutoff.setDate(cutoff.getDate() - settings.retentionDays + 1);
    const firstDay = localDay(cutoff);
    for (const entry of fs.readdirSync(settings.directory, { withFileTypes: true })) {
      const match = /^project-manage-(?:server|launcher)-(\d{4}-\d{2}-\d{2})-\d+\.jsonl$/.exec(entry.name);
      if (entry.isFile() && match && match[1] < firstDay) {
        try { fs.unlinkSync(path.join(settings.directory, entry.name)); }
        catch (error) {
          if (error.code !== 'ENOENT' && !cleanupFailed) {
            cleanupFailed = true;
            terminal({ time: date.toISOString(), level: 'warn', module: 'logger', event: 'logger.cleanup_failed',
              msg: '过期日志清理失败，继续写入当天日志', pid, errorCode: error.code || 'LOG_CLEANUP_ERROR' });
          }
        }
      }
    }
    current?.end();
    current = fs.createWriteStream(path.join(settings.directory, `project-manage-${role}-${nextDay}-${pid}.jsonl`), { flags: 'a', encoding: 'utf8' });
    const stream = current;
    streams.add(stream);
    stream.on('error', fileError);
    stream.on('close', () => streams.delete(stream));
    day = nextDay;
  }

  // Pino supplies one serialized record per write. Filter again at the output boundary,
  // including child bindings, so framework request objects cannot leak into either sink.
  const destination = { write(line) {
    if (closed) return;
    const raw = JSON.parse(line);
    const record = { time: raw.time, level: raw.level, module: raw.module || role,
      event: raw.event || 'runtime.message', msg: clean(raw.msg || ''), pid };
    for (const key of fields) {
      if (['string', 'number', 'boolean'].includes(typeof raw[key])) record[key] = typeof raw[key] === 'string' ? clean(raw[key]) : raw[key];
    }
    if (raw.err) {
      record.err = raw.err;
      if (!record.errorCode && raw.err.code) record.errorCode = raw.err.code;
    }
    terminal(record);
    if (settings.fileEnabled && !fileFailed) {
      try { rotate(now()); current.write(JSON.stringify(record) + '\n'); } catch (error) { fileError(error); }
    }
  } };
  const logger = pino({
    level: settings.level,
    base: { pid, module: role, role },
    timestamp: () => `,"time":${JSON.stringify(now().toISOString())}`,
    formatters: { level: label => ({ level: label }) },
    hooks: { logMethod(args, method) {
      // Fastify emits one address per network interface; server.started is the startup summary.
      if (typeof args[0] === 'string' && args[0].startsWith('Server listening at ')) return;
      method.apply(this, args);
    } },
    mixin: () => ({ ...context.getStore() }),
    serializers: { err(error) {
      if (errorWasLogged(error)) return undefined;
      if (error && typeof error === 'object') loggedErrors.add(error);
      return { type: clean(error?.name || 'Error'), message: clean(error?.message || '未知错误'),
        ...(error?.code ? { code: clean(error.code) } : {}), ...(error?.stack ? { stack: clean(error.stack) } : {}) };
    } },
  }, destination);
  if (settings.fileEnabled) { try { rotate(now()); } catch (error) { fileError(error); } }

  function close() {
    if (closing) return closing;
    closed = true;
    closing = new Promise(resolve => {
      const finish = () => {
        for (const stream of consoleStreams) stream.off('error', ignoreConsoleError);
        resolve();
      };
      const timer = setTimeout(() => { for (const stream of streams) stream.destroy(); finish(); }, 2000);
      const flushes = [...streams].map(stream => new Promise(done => {
        if (stream.closed) return done();
        stream.once('close', done); stream.end();
      }));
      for (const stream of consoleStreams) flushes.push(new Promise(done => {
        try { stream.write('', () => done()); } catch { done(); }
      }));
      Promise.all(flushes).then(() => { clearTimeout(timer); finish(); });
    });
    return closing;
  }
  return { logger, settings, close };
}

let runtime;
export function getRuntimeLogger() { return runtime ||= createRuntimeLogger(); }
export function moduleLogger(module) { return getRuntimeLogger().logger.child({ module }); }
export async function closeRuntimeLogger() { await runtime?.close(); }
export async function exitWithLogs(code) { await closeRuntimeLogger(); process.exit(code); }
