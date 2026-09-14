import {afterAll,beforeAll,expect,it} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID,scryptSync} from 'node:crypto';
import type {FastifyInstance} from 'fastify';
import type {Feature,IntakeCatalog} from '../src/shared/intake';
import type {PathAnalysis} from '../src/shared/paths';
import type {DependencyChanges} from '../src/shared/path-contracts';

const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pm-canvas-batch-')),password='canvas-batch-tests';
Object.assign(process.env,{DB_PATH:path.join(dir,'test.db'),BACKUP_DIR:path.join(dir,'backups'),WEB_DIST_DIR:path.join(dir,'web'),SEED_DEMO:'0',NODE_ENV:'test',APP_PASSWORD_HASH:'scrypt$canvas$'+scryptSync(password,'canvas',64).toString('hex'),SESSION_SECRET:'canvas-batch-isolated-test-secret-123456789'});
let app:FastifyInstance,cookie='';
const request=(method:'GET'|'POST'|'DELETE',url:string,payload?:unknown)=>app.inject({method,url,headers:{cookie},payload:payload as Record<string,unknown>});
beforeAll(async()=>{app=await(await import('../src/server/app')).buildApp();await app.ready();const login=await request('POST','/api/login',{username:'admin',password});cookie=String(login.headers['set-cookie']).split(';')[0];});
afterAll(async()=>{await app.close();(await import('../src/server/database')).sqlite.close();expect(path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep)).toBe(true);fs.rmSync(dir,{recursive:true,force:true});});
async function fixture(){
 const p=(await request('POST','/api/projects',{name:'连贯画布 '+randomUUID()})).json<{id:string}>(),base='/api/projects/'+p.id;
 const create=async(name:string)=>(await request('POST',base+'/features',{name,sortOrder:999})).json<IntakeCatalog>().features.find(g=>g.name===name)!;
 const a=await create('基础'),b=await create('协作'),c=await create('扩展');
 const analysis=async()=>(await request('GET',base+'/path-analysis')).json<PathAnalysis>();
 const preview=async(changes:DependencyChanges)=>{const input={expectedRevision:(await analysis()).revision,target:'project',changes};const response=await request('POST',base+'/dependency-changes/preview',input);return {input,response};};
 const apply=async(changes:DependencyChanges)=>{const {input,response}=await preview(changes);expect(response.statusCode,response.body).toBe(200);return request('POST',base+'/dependency-changes/apply',{...input,previewToken:response.json().previewToken,batchId:randomUUID()});};
 return {base,a,b,c,analysis,preview,apply};
}
const empty=():DependencyChanges=>({add:[],remove:[],estimates:[]});
it('规划关系和多个布局原子保存，回执映射稳定且不改变执行分析或评估',async()=>{
 const {base,a,b,analysis,preview}=await fixture(),before=await analysis();
 const changes:DependencyChanges={...empty(),featureRelations:[{op:'create',id:'draft-planning',sourceFeatureId:a.id,targetFeatureId:b.id,note:'先完成基础验证'}],layouts:[{scope:'features',direction:'right',expectedVersion:0,positions:{['feature:'+a.id]:{x:120,y:80}}},{scope:'feature:'+a.id,direction:'right',expectedVersion:0,positions:{}}]};
 const {input,response}=await preview(changes);expect(response.statusCode,response.body).toBe(200);expect(response.json().analysis.featureContext.relations[0].id).toBe('draft-planning');
 const payload={...input,previewToken:response.json().previewToken,batchId:randomUUID()},saved=await request('POST',base+'/dependency-changes/apply',payload);expect(saved.statusCode,saved.body).toBe(200);
 expect((await request('POST',base+'/dependency-changes/apply',payload)).json()).toEqual(saved.json());
 expect((await request('GET',base+'/dependency-changes/'+payload.batchId)).json()).toMatchObject({status:'applied',addedIds:saved.json().addedIds});
 expect((await request('GET',base+'/feature-relations')).json()[0].id).toBe(saved.json().addedIds['draft-planning']);
 const after=await analysis();expect({...after,layouts:[],revision:0}).toEqual({...before,layouts:[],revision:0});
 const features=(await request('GET',base+'/features')).json<Feature[]>();expect(features.find(g=>g.id===a.id)?.assessedAt).toBe(a.assessedAt);
});
it('按最终规划网络校验：删除旧边后建立反向边，循环与布局冲突都不会部分提交',async()=>{
 const {base,a,b,c,apply,preview}=await fixture();
 await apply({...empty(),featureRelations:[{op:'create',id:'ab',sourceFeatureId:a.id,targetFeatureId:b.id,note:''},{op:'create',id:'bc',sourceFeatureId:b.id,targetFeatureId:c.id,note:''}]});
 const relations=(await request('GET',base+'/feature-relations')).json<Array<{id:string;sourceFeatureId:string;version:number}>>(),ab=relations.find(r=>r.sourceFeatureId===a.id)!;
 const {response}=await preview({...empty(),featureRelations:[{op:'create',id:'ca',sourceFeatureId:c.id,targetFeatureId:a.id,note:''}]});expect(response.statusCode).toBe(409);
 const valid=await apply({...empty(),featureRelations:[{op:'delete',id:ab.id,expectedVersion:ab.version},{op:'create',id:'ba',sourceFeatureId:b.id,targetFeatureId:a.id,note:''}]});expect(valid.statusCode,valid.body).toBe(200);
 const latest=(await request('GET',base+'/feature-relations')).json<Array<{id:string;sourceFeatureId:string;targetFeatureId:string;version:number}>>(),same=latest[0];
 const replacement=await apply({...empty(),featureRelations:[{op:'create',id:'replace-same-pair',sourceFeatureId:same.sourceFeatureId,targetFeatureId:same.targetFeatureId,note:'替换说明'},{op:'delete',id:same.id,expectedVersion:same.version}]});expect(replacement.statusCode,replacement.body).toBe(200);
 const remaining=(await request('GET',base+'/feature-relations')).json();
 const failed=await preview({...empty(),featureRelations:[{op:'create',id:'ac',sourceFeatureId:a.id,targetFeatureId:c.id,note:''}],layouts:[{scope:'features',direction:'right',expectedVersion:8,positions:{}}]});expect(failed.response.statusCode).toBe(409);
 expect((await request('GET',base+'/feature-relations')).json()).toEqual(remaining);
});
it('预览后规划关系变化或端点归档使令牌失效；混合执行修改全部回滚',async()=>{
 const {base,a,b,c,preview,analysis}=await fixture();
 const changes:DependencyChanges={...empty(),featureRelations:[{op:'create',id:'ab',sourceFeatureId:a.id,targetFeatureId:b.id,note:''}],entities:[{entity:'requirement',op:'create',id:'new-requirement',data:{title:'不得部分创建'}}]};
 const first=await preview(changes);expect(first.response.statusCode,first.response.body).toBe(200);
 await request('POST',base+'/feature-relations',{sourceFeatureId:b.id,targetFeatureId:c.id,note:'另一位用户的修改'});
 const saved=await request('POST',base+'/dependency-changes/apply',{...first.input,previewToken:first.response.json().previewToken,batchId:randomUUID()});expect(saved.statusCode,saved.body).toBe(409);expect((await analysis()).requirements).toHaveLength(0);
 const second=await preview(changes);expect(second.response.statusCode,second.response.body).toBe(200);
 await request('POST',base+'/features/'+a.id+'/archive',{expectedVersion:a.version});
 const archived=await request('POST',base+'/dependency-changes/apply',{...second.input,previewToken:second.response.json().previewToken,batchId:randomUUID()});expect(archived.statusCode).toBe(409);expect((await analysis()).requirements).toHaveLength(0);
});
