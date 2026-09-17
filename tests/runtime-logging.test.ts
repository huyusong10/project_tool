import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';
import { afterEach, expect, it, vi } from 'vitest';
import { readLogConfig, runWithLogContext, type RuntimeLogger } from '../scripts/runtime-logger.mjs';
import { captureLogs } from './logging-test-support';

const directories: string[] = [], loggers: RuntimeLogger[] = [];
const directory = () => { const name = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-logs-')); directories.push(name); return name; };
const capture = (options: Parameters<typeof captureLogs>[0] = {}) => { const result = captureLogs(options); loggers.push(result); return result; };
afterEach(async () => {
  await Promise.all(loggers.splice(0).map(logger => logger.close()));
  for (const dir of directories.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

it('默认配置与测试模式明确，非法可选参数回退默认值', () => {
  expect(readLogConfig({})).toMatchObject({ level: 'info', format: 'auto', retentionDays: 14, fileEnabled: true, slowMs: 1000 });
  expect(readLogConfig({ NODE_ENV: 'test' }).fileEnabled).toBe(false);
  expect(readLogConfig({ NODE_ENV: 'test', LOG_FILE_ENABLED: '1' }).fileEnabled).toBe(true);
  expect(readLogConfig({ LOG_LEVEL: 'invalid', LOG_SLOW_MS: '-1', LOG_RETENTION_DAYS: '0' })).toMatchObject({ level: 'info', slowMs: 1000, retentionDays: 14 });
});

it('同一事件写入两个输出，使用文本级别、ISO 时间和字段白名单', async () => {
  const dir = directory(), log = capture({ fileEnabled: true, directory: dir, secrets: ['test-password', 'test-token'] });
  const child = log.logger.child({ module: 'test', password: 'test-password' });
  child.debug({ event: 'hidden' }, '默认隐藏');
  child.info({ event: 'test.ok', req: { headers: { cookie: 'test-token' } }, body: { password: 'test-password' } }, '成功');
  const error = Object.assign(new Error('Bearer test-token password=test-password'), { code: 'TEST_FAILURE' });
  child.error({ event: 'test.failed', err: error }, '失败');
  child.error({ event: 'test.propagated', err: error }, '上层结果');
  await log.close();
  const records = log.records();
  expect(records.map(row => row.level)).toEqual(['info', 'error', 'error']);
  expect(records[0]).toMatchObject({ module: 'test', event: 'test.ok', msg: '成功', pid: process.pid });
  expect(records[0].time).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
  expect(records[1].errorCode).toBe('TEST_FAILURE');
  expect(records[1].err?.stack).toBeTruthy();
  expect(records[2].err).toBeUndefined();
  const file = fs.readFileSync(path.join(dir, fs.readdirSync(dir)[0]), 'utf8');
  expect(file.trim().split('\n').map(line => JSON.parse(line))).toEqual(records);
  for (const text of [file, log.output.stdout, log.output.stderr]) {
    expect(text).not.toContain('test-password'); expect(text).not.toContain('test-token');
    expect(text).not.toContain('headers'); expect(text).not.toContain('"body"'); expect(text).not.toContain('\x1b');
  }
});

it('终端自动选择文本或 JSON，文本显示时区和毫秒', async () => {
  let output = '';
  const terminal = Object.assign(new Writable({ write(chunk, _encoding, done) { output += chunk; done(); } }), { isTTY: true });
  const log = capture({ format: 'auto', stdout: terminal });
  log.logger.info({ event: 'http.completed', module: 'http', durationMs: 18 }, '请求完成');
  log.logger.info({ event: 'server.started' }, '服务启动');
  await log.close();
  expect(output).toMatch(/\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2}/);
  expect(output).toContain('[http] 请求完成 duration=18ms');
  expect(output).toContain(`服务启动 pid=${process.pid}`);
  expect(output.split('\n')[0]).not.toContain('pid=');
  const redirected = capture({ format: 'auto' });
  redirected.logger.info({ event: 'test.redirected' }, '重定向');
  expect(redirected.records()[0].level).toBe('info');
});

it('按本地日切换，只清理 14 天之外的自有日志，重启追加且进程隔离', async () => {
  const dir = directory();
  let clock = new Date(2026, 8, 16, 23, 59);
  const old = 'project-manage-server-2026-09-02-100.jsonl', retained = 'project-manage-server-2026-09-03-100.jsonl';
  for (const name of [old, retained, 'unrelated-2020-01-01.jsonl', 'project-manage-server-2020-01-01-no-pid.jsonl']) fs.writeFileSync(path.join(dir, name), '');
  const log = capture({ directory: dir, fileEnabled: true, now: () => clock, pid: 101 });
  expect(fs.existsSync(path.join(dir, old))).toBe(false);
  expect(fs.existsSync(path.join(dir, retained))).toBe(true);
  log.logger.info({ event: 'day.one' }, '跨日前');
  clock = new Date(2026, 8, 17, 0, 1);
  log.logger.info({ event: 'day.two' }, '跨日后');
  await log.close();
  expect(fs.existsSync(path.join(dir, retained))).toBe(false);
  const again = capture({ directory: dir, fileEnabled: true, now: () => clock, pid: 101 });
  const launcher = capture({ directory: dir, fileEnabled: true, now: () => clock, pid: 102, role: 'launcher' });
  again.logger.info({ event: 'day.append' }, '重启追加'); launcher.logger.info({ event: 'launcher.ok' }, '启动器');
  await Promise.all([again.close(), launcher.close()]);
  expect(fs.readFileSync(path.join(dir, 'project-manage-server-2026-09-17-101.jsonl'), 'utf8').trim().split('\n')).toHaveLength(2);
  expect(fs.existsSync(path.join(dir, 'project-manage-launcher-2026-09-17-102.jsonl'))).toBe(true);
  expect(fs.existsSync(path.join(dir, 'unrelated-2020-01-01.jsonl'))).toBe(true);
  expect(fs.existsSync(path.join(dir, 'project-manage-server-2020-01-01-no-pid.jsonl'))).toBe(true);
});

it('无法写入目录或文件时只报错一次，继续输出终端', async () => {
  const dir = directory(), blocked = path.join(dir, 'blocked');
  fs.writeFileSync(blocked, 'not a directory');
  const log = capture({ directory: blocked, fileEnabled: true });
  log.logger.info({ event: 'still.running' }, '继续运行');
  log.logger.info({ event: 'still.running' }, '继续运行');
  await log.close();
  expect(log.records().filter(row => row.event === 'logger.file_failed')).toHaveLength(1);
  expect(log.records().filter(row => row.event === 'still.running')).toHaveLength(2);

  const day = new Date(2026, 8, 16);
  fs.mkdirSync(path.join(dir, 'project-manage-server-2026-09-16-999.jsonl'));
  const asyncFailure = capture({ directory: dir, fileEnabled: true, pid: 999, now: () => day });
  asyncFailure.logger.info({ event: 'file.opening' }, '异步打开文件');
  await asyncFailure.close();
  expect(asyncFailure.records().filter(row => row.event === 'logger.file_failed')).toHaveLength(1);
});

it('并发请求上下文不串号，退出后没有残留上下文', async () => {
  const log = capture();
  await Promise.all(['one', 'two'].map(reqId => runWithLogContext({ reqId }, async () => {
    await new Promise(resolve => setImmediate(resolve));
    log.logger.info({ event: 'context.detail', backupName: 'only-this-event' }, '内部事件');
    log.logger.info({ event: 'context.test' }, '请求内');
  })));
  log.logger.info({ event: 'context.outside' }, '请求外');
  expect(log.records().filter(row => row.event !== 'context.detail').map(row => row.reqId)).toEqual(['one', 'two', undefined]);
  expect(log.records().filter(row => row.event !== 'context.detail').every(row => row.backupName === undefined)).toBe(true);
});

it('输出流阻塞时关闭最多等待 2 秒', async () => {
  const stalled = new Writable({ write() { /* Deliberately never acknowledge the write. */ } });
  const log = capture({ stdout: stalled });
  log.logger.info({ event: 'shutdown.pending' }, '等待刷新');
  vi.useFakeTimers();
  try {
    const closing = log.close();
    await vi.advanceTimersByTimeAsync(2000);
    await closing;
  } finally { vi.useRealTimers(); stalled.destroy(); }
});

it('详细原因、账号、Token 名称和异常堆栈均保持一条物理行，凭据仍被脱敏', async () => {
  const log = capture({ format: 'text', secrets: ['private-password'] });
  log.logger.error({ event: 'http.completed', user: '张三\n伪造日志', accountId: 'account-1', sourceIp: '192.168.1.8',
    reason: '输入包含换行\r\n和制表\t符', reasonCode: 'VALIDATION_ERROR', tokenName: '需求录入工具',
    err: new Error('password=private-password token=pm_1234567890_private-token-value') }, '处理失败');
  await log.close();
  const lines = log.output.stderr.trimEnd().split('\n');
  expect(lines).toHaveLength(1);
  expect(lines[0]).toContain('user="张三\\n伪造日志"');
  expect(lines[0]).toContain('sourceIp=192.168.1.8');
  expect(lines[0]).toContain('reasonCode=VALIDATION_ERROR');
  expect(lines[0]).toContain('tokenName=需求录入工具');
  expect(lines[0]).toContain('stack=');
  expect(lines[0]).not.toContain('private-password');
  expect(lines[0]).not.toContain('private-token-value');
});
