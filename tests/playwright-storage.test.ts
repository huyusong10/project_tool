import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {expect,it} from 'vitest';

const configPath=fileURLToPath(new URL('../playwright.config.ts',import.meta.url));
const probe=String.raw`
  import fs from 'node:fs';
  import path from 'node:path';
  import {pathToFileURL} from 'node:url';
  const root=process.argv[2];
  const legacy=path.join(root,'project-manage-playwright-'+process.pid+'.db');
  const legacyBackups=path.join(root,'project-manage-playwright-backups-'+process.pid);
  fs.writeFileSync(legacy,'previous run evidence');
  fs.mkdirSync(legacyBackups);fs.writeFileSync(path.join(legacyBackups,'retained.db'),'previous backup');
  const {default:config}=await import(pathToFileURL(process.argv[1]).href);
  const env=config.webServer.env;
  fs.mkdirSync(path.dirname(env.DB_PATH),{recursive:true});
  fs.writeFileSync(env.DB_PATH,'current database');
  fs.writeFileSync(env.DB_PATH+'-wal','current WAL');
  fs.writeFileSync(env.DB_PATH+'-shm','current SHM');
  fs.mkdirSync(env.BACKUP_DIR,{recursive:true});fs.writeFileSync(path.join(env.BACKUP_DIR,'current.db'),'current backup');
  let moved,redirected;
  if(process.argv[3]==='redirect'){
    const owned=path.dirname(env.DB_PATH);
    moved=owned+'-moved';redirected=path.join(root,'other-test-data');
    if(path.dirname(owned)!==root||fs.realpathSync(owned)!==owned||path.dirname(moved)!==root)throw new Error('Unsafe test fixture');
    fs.mkdirSync(redirected);fs.writeFileSync(path.join(redirected,'retained.db'),'other test data');
    fs.renameSync(owned,moved);fs.symlinkSync(redirected,owned,'junction');
  }
  console.log(JSON.stringify({dbPath:env.DB_PATH,backupDir:env.BACKUP_DIR,legacy,legacyBackups,moved,redirected}));
  process.exit(process.argv[3]==='redirect'?0:Number(process.argv[3]));
`;

it.each([0,1,'redirect'] as const)('浏览器验证退出%s时只清理本次原位临时库，保留其他资料',mode=>{
  const root=fs.realpathSync(os.tmpdir()),directory=fs.mkdtempSync(path.join(root,'playwright-storage-check-'));
  try{
    const child=spawnSync(process.execPath,['--import','tsx','--input-type=module','-e',probe,configPath,directory,String(mode)],{
      cwd:path.dirname(configPath),encoding:'utf8',timeout:20_000,env:{...process.env,TMPDIR:directory,TEMP:directory,TMP:directory},
    });
    expect(child.error).toBeUndefined();expect(child.status,child.stderr).toBe(mode==='redirect'?1:mode);
    const output=JSON.parse(child.stdout.trim()) as {dbPath:string;backupDir:string;legacy:string;legacyBackups:string;moved:string;redirected:string};
    if(mode==='redirect'){
      expect(child.stderr).toContain('测试临时目录位置已变化');
      expect(fs.readFileSync(path.join(output.redirected,'retained.db'),'utf8')).toBe('other test data');
      expect(fs.readFileSync(path.join(output.moved,'test.db'),'utf8')).toBe('current database');
    }else{
      for(const file of [output.dbPath,output.dbPath+'-wal',output.dbPath+'-shm',output.backupDir])expect.soft(fs.existsSync(file),file).toBe(false);
      expect.soft(fs.readdirSync(directory).filter(name=>name.startsWith('project-manage-playwright-')).sort()).toEqual([path.basename(output.legacy),path.basename(output.legacyBackups)].sort());
    }
    expect.soft(fs.readFileSync(output.legacy,'utf8')).toBe('previous run evidence');
    expect.soft(fs.readFileSync(path.join(output.legacyBackups,'retained.db'),'utf8')).toBe('previous backup');
  }finally{
    expect(path.dirname(directory)).toBe(root);expect(fs.realpathSync(directory)).toBe(directory);
    fs.rmSync(directory,{recursive:true,force:true});
  }
});
