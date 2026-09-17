import { AsyncLocalStorage } from 'node:async_hooks';
import type { Database } from 'better-sqlite3';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type { config } from './config';
import type * as schema from './schema';

export type DatabaseContext = {
  sqlite: Database;
  db: BetterSQLite3Database<typeof schema>;
  config: typeof config;
  close(): void;
};

const current = new AsyncLocalStorage<DatabaseContext>();
let defaultContext: DatabaseContext | undefined;

/** The application entry point installs the default used by CLI jobs and the scheduler. */
export function setDefaultDatabase(context: DatabaseContext) {
  defaultContext = context;
}

export function getDefaultDatabase() {
  return defaultContext?.sqlite.open ? defaultContext : undefined;
}

export function getDatabaseContext(): DatabaseContext {
  const context = current.getStore() ?? getDefaultDatabase();
  if (!context) throw new Error('Database has not been initialized by the application entry point');
  return context;
}

/** Each request keeps its injected connection across asynchronous work. */
export function runWithDatabase<T>(context: DatabaseContext, operation: () => T): T {
  return current.run(context, operation);
}
