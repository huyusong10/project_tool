import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { config } from '../../src/server/config';
import { openDatabase } from '../../src/server/database';
import { runWithDatabase } from '../../src/server/database-context';
import { buildApp } from '../../src/server/app';
import { createRuntimeLogger, type LogSettings } from '../../scripts/runtime-logger.mjs';

export type TestOptions = { now?: () => Date; logLevel?: LogSettings['level'] };

export async function createTestDatabase() {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'pm-test-'));
  try {
    const context=await openDatabase({...config,dbPath:path.join(directory,'test.db'),backupDir:path.join(directory,'backups'),
      seedDemo:false,nodeEnv:'test',appPasswordHash:'scrypt$isolated$00',sessionSecret:'isolated-test-session-secret-more-than-32-characters',sessionCookieName:'test_'+randomUUID().replaceAll('-','')});
    return { directory, context,
      run<T>(read:()=>T):T { return runWithDatabase(context,read); },
      close() { context.close();fs.rmSync(directory,{recursive:true,force:true}); },
    };
  } catch(error) { fs.rmSync(directory,{recursive:true,force:true});throw error; }
}

export async function createTestApp(options: TestOptions = {}) {
  const database=await createTestDatabase();
  const now=options.now||(()=>new Date('2026-09-17T04:00:00Z'));
  const runtime=createRuntimeLogger({level:options.logLevel||'silent',fileEnabled:false,directory:path.join(database.directory,'logs'),now});
  try {
    const app=await buildApp(runtime,database.context);
    return {...database,app,now,runtime,async close(){await app.close();await runtime.close();database.close();}};
  } catch(error){await runtime.close();database.close();throw error;}
}
