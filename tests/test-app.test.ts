import fs from 'node:fs';
import { expect, it } from 'vitest';
import { getDatabaseContext } from '../src/server/database-context';
import { createTestApp } from './support/test-app';
import {hashPassword,verifySessionToken} from '../src/server/auth';

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

it('injected applications use their own login cookie and signing secret',async()=>{
  const apps=await Promise.all([createTestApp(),createTestApp()]);
  try{
    const password='isolated-login-password',hash=hashPassword(password);
    for(const fixture of apps)fixture.context.sqlite.prepare("UPDATE accounts SET password_hash=? WHERE username='admin'").run(hash);
    const logins=await Promise.all(apps.map(f=>f.app.inject({method:'POST',url:'/api/login',payload:{username:'admin',password}})));
    for(const [index,login] of logins.entries()){
      expect(login.statusCode).toBe(200);const own=apps[index],other=apps[1-index],cookie=login.cookies[0];
      expect(cookie.name).toBe(own.context.config.sessionCookieName);
      expect(own.run(()=>verifySessionToken(cookie.value))).toMatchObject({accountId:login.json().accountId});
      expect(other.run(()=>verifySessionToken(cookie.value))).toBeNull();
      const headers={cookie:cookie.name+'='+cookie.value};
      expect((await own.app.inject({url:'/api/session',headers})).json().authenticated).toBe(true);
      expect((await other.app.inject({url:'/api/session',headers})).json().authenticated).toBe(false);
      const logout=await own.app.inject({method:'POST',url:'/api/logout',payload:{},headers});
      expect(logout.cookies[0].name).toBe(cookie.name);expect(logout.cookies[0].value).toBe('');
    }
  }finally{await Promise.all(apps.map(f=>f.close()));}
});
