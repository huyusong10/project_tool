import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { defaultAnalyticsLayout, type AnalyticsQueryResponse } from '../src/shared/analytics';

const dbPath = path.join(process.cwd(), 'data', `performance-${randomUUID()}.db`);
process.env.DB_PATH = dbPath;
process.env.BACKUP_DIR = path.join(process.cwd(), 'data', `performance-backups-${randomUUID()}`);
process.env.SEED_DEMO = '0';
process.env.APP_PASSWORD_HASH = 'scrypt$test$00';
process.env.SESSION_SECRET = 'performance-test-session-secret-more-than-32-chars';

let sqlite: import('better-sqlite3').Database;
let getDashboard: (projectId?: string) => unknown;
let getPeopleConcurrency: (filters?: { projectId?: string }) => unknown;
let queryAnalytics: (input: unknown) => AnalyticsQueryResponse;
let projectId = '';

beforeAll(async () => {
  const database = await import('../src/server/database');
  sqlite = database.sqlite;
  ({ getDashboard, getPeopleConcurrency } = await import('../src/server/services'));
  ({ queryAnalytics } = await import('../src/server/analytics'));
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
});
