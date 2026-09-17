import { Writable } from 'node:stream';
import { createRuntimeLogger } from '../scripts/runtime-logger.mjs';

export type LogRecord = { level: string; event: string; reqId?: string; err?: { stack?: string }; [key: string]: unknown };
export function captureLogs(options: Parameters<typeof createRuntimeLogger>[0] = {}) {
  const output = { stdout: '', stderr: '' };
  const stream = (key: keyof typeof output) => new Writable({ write(chunk, _encoding, done) { output[key] += chunk.toString(); done(); } });
  const runtime = createRuntimeLogger({ level: 'info', fileEnabled: false, format: 'json', stdout: stream('stdout'), stderr: stream('stderr'), ...options });
  return { ...runtime, output, clear() { output.stdout = ''; output.stderr = ''; },
    records: () => (output.stdout + output.stderr).split('\n').filter(Boolean).map(line => JSON.parse(line) as LogRecord) };
}
