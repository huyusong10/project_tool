import type { Logger, LevelWithSilent } from 'pino';
import type { Writable } from 'node:stream';

export interface LogSettings {
  level: LevelWithSilent;
  format: 'auto' | 'text' | 'json';
  directory: string;
  retentionDays: number;
  fileEnabled: boolean;
  slowMs: number;
}
export interface RuntimeLogger {
  logger: Logger;
  settings: LogSettings;
  close(): Promise<void>;
}
export function readLogConfig(env?: NodeJS.ProcessEnv): LogSettings;
export function createRuntimeLogger(options?: Partial<LogSettings> & {
  stdout?: Writable & { isTTY?: boolean }; stderr?: Writable & { isTTY?: boolean };
  now?: () => Date; role?: 'server' | 'launcher'; pid?: number; secrets?: string[];
}): RuntimeLogger;
export interface LogContext {
  reqId?: string;
  user?: string; accountId?: string; actorType?: string; authMethod?: string; accessMode?: string; sourceIp?: string;
  tokenId?: string; tokenName?: string; attemptedUser?: string;
  projectId?: string; projectName?: string; resourceType?: string; resourceId?: string;
  requirementId?: string; workItemId?: string; featureId?: string; phaseId?: string;
  fields?: string; reason?: string; reasonCode?: string; validationFields?: string;
  expectedVersion?: number; currentVersion?: number;
}
export function runWithLogContext<T>(bindings: LogContext, callback: () => T): T;
export function updateLogContext(bindings: LogContext): void;
export function readLogContext(): LogContext;
export function errorWasLogged(error: unknown): boolean;
export function getRuntimeLogger(): RuntimeLogger;
export function moduleLogger(module: string): Logger;
export function closeRuntimeLogger(): Promise<void>;
export function exitWithLogs(code: number): Promise<never>;
