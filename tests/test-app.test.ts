import fs from 'node:fs';
import { expect, it } from 'vitest';
import { getDatabaseContext } from '../src/server/database-context';
import { createTestApp } from './support/test-app';

it('test app owns its database, cookie, clock, logger and cleanup',async()=>{
  const fixture=await createTestApp({now:()=>new Date('2026-09-17T00:00:00Z')});
  try {
    expect(fixture.runtime.settings.level).toBe('silent');
    expect(fixture.now().toISOString()).toBe('2026-09-17T00:00:00.000Z');
    expect(fixture.context.config.sessionCookieName).toMatch(/^test_/);
    expect(fixture.run(()=>getDatabaseContext())).toBe(fixture.context);
    expect((await fixture.app.inject({method:'GET',url:'/health'})).statusCode).toBe(200);
  } finally { await fixture.close(); }
  expect(fs.existsSync(fixture.directory)).toBe(false);
});
