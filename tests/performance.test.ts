import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { defaultAnalyticsLayout, type AnalyticsQueryResponse } from '../src/shared/analytics';
import type { AuthorizationActor } from '../src/server/authorization';

const dbPath = path.join(process.cwd(), 'data', `performance-${randomUUID()}.db`);
process.env.DB_PATH = dbPath;
process.env.BACKUP_DIR = path.join(process.cwd(), 'data', `performance-backups-${randomUUID()}`);
process.env.SEED_DEMO = '0';
process.env.APP_PASSWORD_HASH = 'scrypt$test$00';
process.env.SESSION_SECRET = 'performance-test-session-secret-more-than-32-chars';

let sqlite: import('better-sqlite3').Database;
let getDashboard: (projectId?: string) => unknown;
let getPeopleConcurrency: (filters?: { projectId?: string }) => unknown;
let listRequirements: typeof import('../src/server/services/requirements').listRequirements;
let getCancellationHistory: typeof import('../src/server/services/work-item-history').getCancellationHistory;
let queryAnalytics: (input: unknown) => AnalyticsQueryResponse;
let listActionItems: typeof import('../src/server/services/actions').listActionItems;
let projectId = '';

beforeAll(async () => {
  const database = await import('../src/server/database');
  sqlite = database.sqlite;
  ({ getDashboard, getPeopleConcurrency } = await import('../src/server/services'));
  ({ listRequirements } = await import('../src/server/services/requirements'));
  ({ getCancellationHistory } = await import('../src/server/services/work-item-history'));
  ({ queryAnalytics } = await import('../src/server/analytics'));
  ({ listActionItems } = await import('../src/server/services/actions'));
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
  if (sqlite.open) sqlite.close();
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(`${dbPath}${suffix}`, { force: true });
  fs.rmSync(process.env.BACKUP_DIR!, { recursive: true, force: true });
});

describe('看板性能', () => {
  it('5000条问题的后台版本检查只读且p95低于500毫秒',async()=>{
    const {projectChangeVersion}=await import('../src/server/services/project-change-version');
    const id=randomUUID(),now=new Date().toISOString();
    sqlite.transaction(()=>{
      sqlite.prepare('INSERT INTO projects(id,name,created_at,updated_at)VALUES(?,?,?,?)').run(id,'后台检查性能',now,now);
      sqlite.prepare("INSERT INTO accounts(id,username,normalized_username,password_hash,global_role,status,created_at,updated_at)VALUES('version-bench-admin','version-bench-admin','version-bench-admin','test-only','admin','active',?,?)").run(now,now);
      const insert=sqlite.prepare("INSERT INTO issues(id,project_id,title,status,discovered_at,created_at,updated_at)VALUES(?,?,?,'in_progress','2026-09-10',?,?)");
      for(let i=0;i<5000;i++)insert.run(randomUUID(),id,'问题'+i,now,now);
    })();
    const actor:AuthorizationActor={type:'user',id:'version-bench-admin',label:'version-bench-admin',accountId:'version-bench-admin',personId:null,globalRole:'admin'};
    const before=sqlite.prepare('SELECT total_changes() AS n').get(),times:number[]=[],baseline=projectChangeVersion(id,actor);
    for(let i=0;i<20;i++){const start=performance.now();expect(projectChangeVersion(id,actor)).toEqual(baseline);times.push(performance.now()-start);}
    const p95=times.sort((a,b)=>a-b)[18];expect(p95).toBeLessThan(500);expect(sqlite.prepare('SELECT total_changes() AS n').get()).toEqual(before);
    console.info('project-refresh-performance',JSON.stringify({issues:5000,samples:20,p95Ms:+p95.toFixed(1)}));
  });
  it('500个需求和5000个工作项在2秒内完成统计', () => {
    const start = performance.now();
    const result = getDashboard(projectId) as { summary: { total: number } };
    const elapsed = performance.now() - start;
    expect(result.summary.total).toBe(500);
    expect(elapsed).toBeLessThan(2000);
  });

  it('单周人员并发热力图在2秒内完成统计', () => {
    const start = performance.now();
    const result = getPeopleConcurrency({ projectId }) as { people: unknown[] };
    const elapsed = performance.now() - start;
    expect(result.people).toHaveLength(50);
    expect(elapsed).toBeLessThan(2000);
  });

  it('默认分析看板批量查询在2秒内完成且24面板在3秒内完成', () => {
    const query = (panels: typeof defaultAnalyticsLayout.panels) => queryAnalytics({
      projectId, range: { from: '2026-06-01', to: '2026-12-01' }, panels,
    });
    let start = performance.now();
    const defaults = query(defaultAnalyticsLayout.panels);
    const defaultElapsed = performance.now() - start;
    expect(defaults.results).toHaveLength(defaultAnalyticsLayout.panels.length);
    expect(defaultElapsed).toBeLessThan(2000);

    const panels = Array.from({ length: 24 }, (_, index) => ({
      ...defaultAnalyticsLayout.panels[index % defaultAnalyticsLayout.panels.length], id: `performance-panel-${index}`,
    }));
    start = performance.now();
    const maximum = query(panels);
    const maximumElapsed = performance.now() - start;
    expect(maximum.results).toHaveLength(24);
    expect(maximumElapsed).toBeLessThan(3000);
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
      const start = performance.now();
      const result = listActionItems({ projectId, pageSize: 100 }, actor);
      const elapsed = performance.now() - start;
      expect(result.total).toBeGreaterThan(0);
      expect(elapsed).toBeLessThan(2000);
      // Complete network/history plus one latest-scope read; independent of node count.
      expect(prepareCount).toBeLessThanOrEqual(15);
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
