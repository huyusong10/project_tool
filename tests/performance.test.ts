import { createTestDatabase } from './support/test-app';
import { profileQueries } from './support/query-profile';
import { measureScenario, writePerformanceReport } from './support/performance';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { defaultAnalyticsLayout, type AnalyticsQueryResponse } from '../src/shared/analytics';
import type { AuthorizationActor } from '../src/server/authorization';
import { req, work } from './fixtures/path-network';

let fixture: Awaited<ReturnType<typeof createTestDatabase>>;

let sqlite: import('better-sqlite3').Database;
let getDashboard: (projectId?: string) => unknown;
let getPeopleConcurrency: (filters?: { projectId?: string }) => unknown;
let listRequirements: typeof import('../src/server/services/requirements').listRequirements;
let getCancellationHistory: typeof import('../src/server/services/work-item-history').getCancellationHistory;
let queryAnalytics: (input: unknown) => AnalyticsQueryResponse;
let listActionItems: typeof import('../src/server/services/actions').listActionItems;
let projectId = '';

beforeAll(async () => {
  fixture=await createTestDatabase();sqlite=fixture.context.sqlite;
  const reporting=await import('../src/server/services/reporting');
  const requirements=await import('../src/server/services/requirements');
  const history=await import('../src/server/services/work-item-history');
  const analytics=await import('../src/server/analytics');
  const actions=await import('../src/server/services/actions');
  getDashboard=(id)=>fixture.run(()=>reporting.getDashboard(id));
  getPeopleConcurrency=(filters)=>fixture.run(()=>reporting.getPeopleConcurrency(filters));
  listRequirements=(...args)=>fixture.run(()=>requirements.listRequirements(...args));
  getCancellationHistory=(...args)=>fixture.run(()=>history.getCancellationHistory(...args));
  queryAnalytics=(input)=>fixture.run(()=>analytics.queryAnalytics(input));
  listActionItems=(...args)=>fixture.run(()=>actions.listActionItems(...args));
  projectId = randomUUID();
  const now = new Date().toISOString();
  sqlite.prepare('INSERT INTO projects (id,name,status,created_at,updated_at) VALUES (?, ?, ?, ?, ?)').run(projectId, '性能测试项目', 'active', now, now);
  const personIds = Array.from({ length: 50 }, () => randomUUID());
  const insertPerson = sqlite.prepare('INSERT INTO people (id,name,job_title,active,created_at,updated_at) VALUES (?,?,?,1,?,?)');
  const insertProjectPerson = sqlite.prepare('INSERT INTO project_people (project_id,person_id,created_at) VALUES (?,?,?)');
  personIds.forEach((id, index) => insertPerson.run(id, `人员${index + 1}`, index % 2 ? '开发' : '测试', now, now));
  personIds.forEach((id) => insertProjectPerson.run(projectId, id, now));
  const insertRequirement = sqlite.prepare(`INSERT INTO requirements (id,project_id,title,status,planned_start,planned_end,progress,risk_level,accepted_at,created_at,updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const insertWorkItem = sqlite.prepare(`INSERT INTO work_items (id,requirement_id,title,owner_id,status,planned_start,planned_end,actual_start,actual_end,progress,sort_order,created_at,updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  sqlite.transaction(() => {
    for (let index = 0; index < 500; index += 1) {
      const requirementId = randomUUID();
      const completed = index % 5 === 0;
      insertRequirement.run(requirementId, projectId, `性能需求 ${index + 1}`, completed ? 'completed' : 'in_progress', '2026-09-01', '2026-09-30', completed ? 100 : index % 100, index % 17 === 0 ? 'high' : 'low', completed ? now : null, now, now);
      for (let item = 0; item < 10; item += 1) {
        const itemCompleted = completed || item < 3;
        insertWorkItem.run(randomUUID(), requirementId, `工作项 ${item + 1}`, personIds[(index * 10 + item) % personIds.length], itemCompleted ? 'completed' : 'in_progress', '2026-09-01', '2026-09-10', '2026-09-01', itemCompleted ? '2026-09-03' : null, itemCompleted ? 100 : 30, item, now, now);
      }
    }
  })();
});

afterAll(() => {
  writePerformanceReport();
  fixture?.close();
});

describe('看板性能', {timeout: 30000}, () => {
  it('特性需求分页不受5000个其他需求和50000个工作项拖慢，全部样本低于100毫秒', async () => {
    const local = await createTestDatabase(), db = local.context.sqlite;
    const { readFeatureRequirements } = await import('../src/server/services/features');
    const now = '2026-09-19T00:00:00.000Z';
    const admin = db.prepare("SELECT id FROM accounts WHERE normalized_username='admin'").get() as { id: string };
    const actor: AuthorizationActor = { type: 'user', id: admin.id, accountId: admin.id, personId: null, globalRole: 'admin', label: '分页性能' };
    try {
      const requirement = db.prepare("INSERT INTO requirements(id,project_id,feature_id,title,status,execution_mode,created_at,updated_at)VALUES(?,'feature-page',?,?,'in_progress','work_items',?,?)");
      const work = db.prepare("INSERT INTO work_items(id,requirement_id,title,status,progress,work_stage,duration_days,actual_start,created_at,updated_at)VALUES(?,?,?,'in_progress',30,'development',3,'2026-09-16',?,?)");
      db.transaction(() => {
        db.prepare('INSERT INTO projects(id,name,created_at,updated_at)VALUES(?,?,?,?)').run('feature-page', '特性分页', now, now);
        db.prepare("INSERT INTO features(id,project_id,name,created_at,updated_at)VALUES('target','feature-page','目标',?,?)").run(now, now);
        for (let index = 0; index < 30; index++) {
          const id = 'target-' + String(index).padStart(2, '0');
          requirement.run(id, 'target', id, now, now); work.run(id + '-work', id, '当前开发', now, now);
        }
      })();
      const read = (page: number) => local.run(() => readFeatureRequirements('feature-page', 'target', 'current', page, 20, actor));
      const baseline = read(1), empty = read(50);
      expect(baseline).toMatchObject({ total: 30, page: 1, pageSize: 20, pages: 2 });
      expect(baseline.items).toHaveLength(20);
      expect(baseline.items.every(item => item.status === 'in_progress' && item.executionStage?.key === 'development')).toBe(true);
      expect(empty.items).toEqual([]);
      db.transaction(() => {
        for (let index = 0; index < 5000; index++) {
          const id = 'noise-' + index;
          requirement.run(id, null, id, now, now);
          for (let item = 0; item < 10; item++) work.run(id + '-work-' + item, id, '其他需求工作', now, now);
        }
      })();
      const unchanged = db.prepare('SELECT total_changes() AS n').get();
      measureScenario('feature-page-with-5000-other-requirements', 100, () => read(1), result => expect(result).toEqual(baseline));
      measureScenario('feature-empty-page-with-5000-other-requirements', 100, () => read(50), result => expect(result).toEqual(empty));
      expect(db.prepare('SELECT total_changes() AS n').get()).toEqual(unchanged);
    } finally { local.close(); }
  });

  it('5000人候选查询保留搜索和可用状态，全部样本低于250毫秒',async()=>{
    const local=await createTestDatabase(),db=local.context.sqlite;
    const {listPeopleCandidates}=await import('../src/server/services/people');
    const now='2026-09-19T00:00:00.000Z',size=5000;
    try{
      db.transaction(()=>{
        db.prepare('INSERT INTO projects(id,name,created_at,updated_at)VALUES(?,?,?,?)').run('candidates','人员候选规模',now,now);
        const person=db.prepare('INSERT INTO people(id,name,active,deleted_at,created_at,updated_at)VALUES(?,?,?,?,?,?)');
        const account=db.prepare("INSERT INTO accounts(id,person_id,username,normalized_username,password_hash,deleted_at,created_at,updated_at)VALUES(?,?,?,?,'test-only',?,?,?)");
        const member=db.prepare("INSERT INTO project_people(project_id,person_id,project_role,created_at)VALUES('candidates',?,'viewer',?)");
        for(let i=0;i<size;i++){
          const id='candidate-'+i;
          const name=i===size-1?'张三远端目标':'人员'+String(i).padStart(5,'0');
          person.run(id,name,i===size-3?0:1,i===size-2?now:null,now,now);
          if(i!==size-6)account.run('candidate-account-'+i,id,'login-'+i,'login-'+i,i===size-5?now:null,now,now);
          if(i%5===0||i===size-4)member.run(id,now);
        }
      })();
      const unchanged=db.prepare('SELECT total_changes() AS n').get();
      const read=(q:string)=>local.run(()=>listPeopleCandidates('candidates',q));
      measureScenario('person-candidates-5000-default',250,()=>read(''),rows=>{
        expect(rows).toHaveLength(50);expect(rows.every(row=>row.canAdd)).toBe(true);
        expect(rows.map(row=>row.id)).toEqual(Array.from({length:63},(_,i)=>i).filter(i=>i%5!==0).slice(0,50).map(i=>'candidate-'+i));
      });
      measureScenario('person-candidates-5000-pinyin',250,()=>read('zhangsanyuanduan'),rows=>{
        expect(rows).toHaveLength(1);expect(rows[0]).toMatchObject({id:'candidate-4999',username:'login-4999',canAdd:true});
      });
      for(const [q,id,reason] of [['人员04998','candidate-4998','archived'],['人员04997','candidate-4997','inactive'],['人员04996','candidate-4996','already_member']] as const){
        const rows=read(q);expect(rows).toHaveLength(1);expect(rows[0]).toMatchObject({id,canAdd:false,unavailableReason:reason});
      }
      expect(read('login-4999')[0].id).toBe('candidate-4999');expect(read('login-4995')).toEqual([]);
      for(const q of ['人员04995','人员04994'])expect(read(q)[0].username).toBeNull();
      expect(db.prepare('SELECT total_changes() AS n').get()).toEqual(unchanged);
    }finally{local.close();}
  });

  it('100个五年计划的需求汇总保留进度参考日期且低于250毫秒', async () => {
    const local = await createTestDatabase(), db = local.context.sqlite;
    const { listRequirements: readRequirements } = await import('../src/server/services/requirements');
    const now = '2026-09-18T00:00:00.000Z';
    try {
      db.transaction(() => {
        db.prepare('INSERT INTO projects(id,name,created_at,updated_at) VALUES(?,?,?,?)').run('long-plans', '多年计划', now, now);
        const requirement = db.prepare(`INSERT INTO requirements(id,project_id,title,status,execution_mode,created_at,updated_at)
          VALUES(?,'long-plans',?,'in_progress','work_items',?,?)`);
        const work = db.prepare(`INSERT INTO work_items(id,requirement_id,title,status,planned_start,planned_end,actual_start,progress,created_at,updated_at)
          VALUES(?,?,?,'in_progress','2022-01-01','2026-12-31','2022-01-01',80,?,?)`);
        for (let index = 0; index < 100; index++) {
          const id = `long-${index}`;
          requirement.run(id, id, now, now);
          work.run(`${id}-work`, id, id, now, now);
        }
      })();
      const unchanged = db.prepare('SELECT total_changes() AS n').get();
      measureScenario('requirements-100-five-year-plans', 250,
        () => local.run(() => readRequirements({ projectId: 'long-plans' }, '2026-09-18')),
        result => {
          expect(result).toHaveLength(100);
          for (const item of result) expect(item).toMatchObject({
            progress: 80, scheduleReferenceDate: '2026-01-08', scheduleVarianceDays: 173,
          });
        });
      expect(db.prepare('SELECT total_changes() AS n').get()).toEqual(unchanged);
    } finally { local.close(); }
  });

  it('1000个账号和10000个工作项的在办计数只读且全部样本低于500毫秒',async()=>{
    const local=await createTestDatabase(),db=local.context.sqlite;
    const {listAccounts}=await import('../src/server/accounts');
    const now='2026-09-01T00:00:00.000Z',size=1000;
    try{
      db.transaction(()=>{
        db.prepare('INSERT INTO projects(id,name,created_at,updated_at)VALUES(?,?,?,?)').run('account-scale','账号任务规模',now,now);
        const person=db.prepare('INSERT INTO people(id,name,active,created_at,updated_at)VALUES(?,?,1,?,?)');
        const account=db.prepare("INSERT INTO accounts(id,person_id,username,normalized_username,password_hash,created_at,updated_at)VALUES(?,?,?,?,'test-only',?,?)");
        const requirement=db.prepare("INSERT INTO requirements(id,project_id,title,owner_id,status,deleted_at,created_at,updated_at)VALUES(?,'account-scale',?,?,'in_progress',?,?,?)");
        const work=db.prepare("INSERT INTO work_items(id,requirement_id,title,owner_id,status,progress,actual_start,actual_end,sort_order,created_at,updated_at)VALUES(?,?,?,?,?,?,'2026-09-01',?,?,?,?)");
        const collaborator=db.prepare('INSERT INTO work_item_collaborators(work_item_id,person_id)VALUES(?,?)');
        for(let i=0;i<size;i++){const id='person'+i;person.run(id,id,now,now);account.run('account'+i,id,id,id,now,now);}
        for(let i=0;i<size;i++){
          const owner='person'+i,rid='r'+i;requirement.run(rid,rid,owner,i%10===0?now:null,now,now);
          for(let j=0;j<10;j++){
            const id=rid+'w'+j;work.run(id,rid,id,owner,j===0?'completed':'in_progress',j===0?100:30,j===0?'2026-09-02':null,j,now,now);
            collaborator.run(id,owner);collaborator.run(id,'person'+((i+1)%size));
          }
        }
      })();
      const unchanged=db.prepare('SELECT total_changes() AS n').get();
      measureScenario('accounts-1000-10000-work',500,()=>local.run(listAccounts),result=>{
        const byPerson=new Map(result.filter(account=>account.personId).map(account=>[account.personId,account.activeAssignments]));
        expect(byPerson.size).toBe(size);
        for(let i=0;i<size;i++)expect(byPerson.get('person'+i)).toEqual({requirements:i%10===0?0:1,workItems:(i%10===0?0:9)+((i+size-1)%10===0?0:9),issues:0});
      });
      expect(db.prepare('SELECT total_changes() AS n').get()).toEqual(unchanged);
    }finally{local.close();}
  });
  it('5000条问题和5000名成员的后台查询只读且符合预算',async()=>{
    const {projectChangeVersion:readVersion}=await import('../src/server/services/project-change-version');
    const {refreshPathAssignments}=await import('../src/server/services/path-assignments');
    const projectChangeVersion=(...args:Parameters<typeof readVersion>)=>fixture.run(()=>readVersion(...args));
    const id=randomUUID(),now=new Date().toISOString(),personIds:string[]=[];
    sqlite.transaction(()=>{
      sqlite.prepare('INSERT INTO projects(id,name,created_at,updated_at)VALUES(?,?,?,?)').run(id,'后台检查性能',now,now);
      sqlite.prepare("INSERT INTO accounts(id,username,normalized_username,password_hash,global_role,status,created_at,updated_at)VALUES('version-bench-admin','version-bench-admin','version-bench-admin','test-only','admin','active',?,?)").run(now,now);
      const insert=sqlite.prepare("INSERT INTO issues(id,project_id,title,owner_id,status,discovered_at,due_date,next_review_at,created_at,updated_at)VALUES(?,?,?,?,'in_progress','2026-09-10','2026-09-15','2026-09-18',?,?)");
      const person=sqlite.prepare('INSERT INTO people(id,name,created_at,updated_at)VALUES(?,?,?,?)');
      const account=sqlite.prepare("INSERT INTO accounts(id,person_id,username,normalized_username,password_hash,status,created_at,updated_at)VALUES(?,?,?,?,'test-only','active',?,?)");
      const member=sqlite.prepare('INSERT INTO project_people(project_id,person_id,created_at,updated_at)VALUES(?,?,?,?)');
      for(let i=0;i<5000;i++){
        const personId=randomUUID(),name='version-member-'+i;
        personIds.push(personId);
        person.run(personId,name,now,now);account.run(randomUUID(),personId,name,name,now,now);member.run(id,personId,now,now);
        insert.run(randomUUID(),id,'问题'+i,personId,now,now);
      }
    })();
    const actor:AuthorizationActor={type:'user',id:'version-bench-admin',label:'version-bench-admin',accountId:'version-bench-admin',personId:null,globalRole:'admin'};
    const before=sqlite.prepare('SELECT total_changes() AS n').get(),baseline=projectChangeVersion(id,actor);
    measureScenario('project-refresh-5000-issues-and-members',500,()=>projectChangeVersion(id,actor),result=>expect(result).toEqual(baseline));
    const snapshot={projectId:id,requirements:personIds.map((ownerId,index)=>({...req('assignment-'+index),projectId:id,ownerId})),workItems:personIds.map((ownerId,index)=>({...work('assigned-work-'+index,'assignment-'+index,1),ownerId}))};
    measureScenario('path-assignments-5000-people',250,()=>{fixture.run(()=>refreshPathAssignments(snapshot));return snapshot;},result=>{
      expect(result.requirements.every((r,index)=>r.ownerValid&&r.ownerName==='version-member-'+index)).toBe(true);
      expect(result.workItems.every((w,index)=>w.ownerName==='version-member-'+index&&w.assigneeIds?.[0]===personIds[index])).toBe(true);
    });
    measureScenario('actions-5000-assigned-issues',500,()=>listActionItems({projectId:id,pageSize:100},actor,undefined,'2026-09-19'),result=>{
      expect(result.total).toBe(5000);expect(result.ownerOptions).toHaveLength(5000);
      expect(result.summary.byReason).toEqual({overdue:5000,follow_up:5000});
      expect(result.items.every(item=>item.ownerId&&item.ownerName?.startsWith('version-member-'))).toBe(true);
    });
    expect(sqlite.prepare('SELECT total_changes() AS n').get()).toEqual(before);
  });
  it('500个需求和5000个工作项在2秒内完成统计', () => {
    measureScenario('dashboard-500-requirements-5000-work',2000,()=>getDashboard(projectId) as {summary:{total:number}},result=>expect(result.summary.total).toBe(500));
  });

  it('看板与特性摘要复用需求批次，并记录 SQL 时间和查询计划',()=>{
    const {queries}=profileQueries(sqlite,()=>getDashboard(projectId));
    expect(queries.filter(query=>query.sql.includes('FROM requirements r JOIN projects pr'))).toHaveLength(1);
    expect(queries.every(query=>query.plan.length>0)).toBe(true);
  });

  it('单周人员并发热力图在2秒内完成统计', () => {
    measureScenario('people-week-50',2000,()=>getPeopleConcurrency({projectId}) as {people:unknown[]},result=>expect(result.people).toHaveLength(50));
  });

  it('默认分析看板批量查询在2秒内完成且24面板在3秒内完成', () => {
    const query = (panels: typeof defaultAnalyticsLayout.panels) => queryAnalytics({
      projectId, range: { from: '2026-06-01', to: '2026-12-01' }, panels,
    });
    measureScenario('analytics-default',2000,()=>query(defaultAnalyticsLayout.panels),result=>expect(result.results).toHaveLength(defaultAnalyticsLayout.panels.length));

    const panels = Array.from({ length: 24 }, (_, index) => ({
      ...defaultAnalyticsLayout.panels[index % defaultAnalyticsLayout.panels.length], id: `performance-panel-${index}`,
    }));
    measureScenario('analytics-24-panels',3000,()=>query(panels),result=>expect(result.results).toHaveLength(24));
  });

  it('人员峰值按每个面板的时间策略独立取数', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-05T04:00:00.000Z'));
    try {
      const result = queryAnalytics({
        projectId,
        range: { from: '2025-01-01', to: '2025-01-10' },
        panels: [
          { id: 'people-past', title: '历史峰值', dataset: 'people', measure: 'peak_concurrency', visualization: 'kpi', size: 'small', timeScope: 'range' },
          { id: 'people-future', title: '未来峰值', dataset: 'people', measure: 'peak_concurrency', visualization: 'kpi', size: 'small', timeScope: 'future30' },
        ],
      });
      expect(result.results[0].rows[0].value).toBe(0);
      expect(result.results[1].rows[0].value).toBeGreaterThan(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('行动中心在2秒内完成，且查询次数不随需求数量增长', () => {
    const actor: AuthorizationActor = {
      type: 'user', id: 'performance-admin', label: 'performance-admin',
      accountId: 'performance-admin', personId: null, globalRole: 'admin',
    };
    const originalPrepare = sqlite.prepare.bind(sqlite);
    let prepareCount = 0;
    sqlite.prepare = ((...args: Parameters<typeof sqlite.prepare>) => {
      prepareCount += 1;
      return originalPrepare(...args);
    }) as typeof sqlite.prepare;
    try {
      measureScenario('actions-500-requirements',2000,()=>{prepareCount=0;return listActionItems({projectId,pageSize:100},actor);},result=>{
        expect(result.total).toBeGreaterThan(0);
        expect(prepareCount).toBeLessThanOrEqual(15);
      });
    } finally {
      sqlite.prepare = originalPrepare as typeof sqlite.prepare;
    }
  });

  it('需求批量读取和取消历史不会生成超过900个参数的IN查询', () => {
    const now = new Date().toISOString();
    const insertRequirement = sqlite.prepare(`INSERT INTO requirements
      (id,project_id,title,status,planned_start,planned_end,progress,risk_level,accepted_at,created_at,updated_at)
      VALUES (?, ?, ?, 'not_started', NULL, NULL, 0, 'low', NULL, ?, ?)`);
    sqlite.transaction(() => {
      for (let index = 0; index < 450; index += 1) {
        insertRequirement.run(randomUUID(), projectId, `分块需求 ${index + 1}`, now, now);
      }
    })();

    const originalPrepare = sqlite.prepare.bind(sqlite);
    const parameterCounts: number[] = [];
    sqlite.prepare = ((...args: Parameters<typeof sqlite.prepare>) => {
      const sql = String(args[0]);
      if (sql.includes(' IN (')) parameterCounts.push(sql.match(/\?/g)?.length || 0);
      return originalPrepare(...args);
    }) as typeof sqlite.prepare;
    try {
      expect(listRequirements({ projectId })).toHaveLength(950);
      const requirementIds = Array.from({ length: 901 }, () => randomUUID());
      const statuses = new Map(requirementIds.map((id) => [id, 'cancelled']));
      const history = getCancellationHistory([], statuses, requirementIds);
      expect(history.requirementDates.size).toBe(0);
      expect(parameterCounts.filter((count) => count === 900).length).toBeGreaterThanOrEqual(3);
      expect(Math.max(...parameterCounts)).toBeLessThanOrEqual(900);
    } finally {
      sqlite.prepare = originalPrepare as typeof sqlite.prepare;
    }
  });
});
