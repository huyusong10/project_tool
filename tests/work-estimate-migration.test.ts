import Database from 'better-sqlite3';
import { expect, it } from 'vitest';
import { initializeLegacyWorkEstimates, legacyProgressWeight } from '../src/server/work-estimate-migration';
import { deriveRequirementMetrics } from '../src/shared/domain';

it('只倒推可核对的排期变更，审计断链时保留现有依据', () => {
  const work = { id:'w', requirementId:'r', createdAt:'2026-09-01', status:'in_progress', plannedStart:'2026-09-09', plannedEnd:'2026-09-16' };
  expect(legacyProgressWeight(work, [{content:'计划完成：2026-09-10 → 2026-09-16',createdAt:'2026-09-11'}], '2026-09-08')).toBe(2);
  expect(legacyProgressWeight(work, [{content:'计划完成：2026-09-10 → 2026-09-15',createdAt:'2026-09-11'}], '2026-09-08')).toBe(6);
  expect(legacyProgressWeight(work, [{content:'计划完成：2026-09-10 → 2026-09-16',createdAt:'2026-09-07'}], '2026-09-08')).toBe(6);
});

it('历史回填保留当前估算、日期和日志；恢复基准权重并可重复启动', () => {
  const db = new Database(':memory:');
  try {
    db.exec(`CREATE TABLE requirements(id TEXT,status TEXT,execution_mode TEXT,progress INTEGER,split_base_progress INTEGER,version INTEGER);
      CREATE TABLE work_items(id TEXT,requirement_id TEXT,status TEXT,progress INTEGER,planned_start TEXT,planned_end TEXT,duration_days INTEGER,progress_weight INTEGER,created_at TEXT,version INTEGER);
      CREATE TABLE progress_updates(requirement_id TEXT,event_type TEXT,created_at TEXT);
      CREATE TABLE audit_logs(entity_type TEXT,entity_id TEXT,action TEXT,summary TEXT,created_at TEXT);
      INSERT INTO requirements VALUES('r','in_progress','work_items',18,0,1);
      INSERT INTO work_items VALUES('dev','r','completed',100,'2026-09-08','2026-09-09',NULL,NULL,'2026-09-01',1),
        ('adapt','r','in_progress',0,'2026-09-09','2026-09-16',NULL,NULL,'2026-09-01',1),
        ('test','r','not_started',0,'2026-09-16','2026-09-18',NULL,NULL,'2026-09-01',1);
      INSERT INTO progress_updates VALUES('r','start','2026-09-08');
      INSERT INTO audit_logs VALUES('work_item','adapt','update','计划完成：2026-09-10 → 2026-09-16','2026-09-11T01:00'),
        ('work_item','test','update','计划完成：2026-09-11 → 2026-09-18','2026-09-11T01:01'),
        ('work_item','test','update','计划开始：2026-09-11 → 2026-09-16','2026-09-11T01:02');`);
    const facts = () => [db.prepare('SELECT id,status,progress,planned_start,planned_end,created_at FROM work_items').all(),db.prepare('SELECT * FROM progress_updates').all(),db.prepare('SELECT * FROM audit_logs').all()];
    const before = facts();
    expect(initializeLegacyWorkEstimates(db).map(w => [w.progressWeight,w.durationDays])).toEqual([[2,2],[2,6],[1,3]]);
    expect(db.prepare('SELECT progress FROM requirements').get()).toEqual({progress:40});
    expect(facts()).toEqual(before);
    expect(initializeLegacyWorkEstimates(db)).toEqual([]);
    expect(db.prepare('SELECT version FROM work_items').all()).toEqual([{version:2},{version:2},{version:2}]);
  } finally { db.close(); }
});

it('改排期和剩余估算不会重算实际完成比例；未排期工作仍有稳定权重', () => {
  const req = { status:'in_progress' }, works = [
    {status:'completed',progress:100,progressWeight:2,durationDays:2,plannedStart:'2026-09-08',plannedEnd:'2026-09-09'},
    {status:'in_progress',progress:0,progressWeight:2,durationDays:2,plannedStart:'2026-09-09',plannedEnd:'2026-09-10'},
    {status:'not_started',progress:0,progressWeight:1,durationDays:1,plannedStart:'2026-09-11',plannedEnd:'2026-09-11'},
  ];
  expect(deriveRequirementMetrics(req,works).progress).toBe(40);
  works[1].plannedEnd = '2026-09-30'; works[1].durationDays = 20;
  expect(deriveRequirementMetrics(req,works).progress).toBe(40);
  works[1].progress = 50;
  expect(deriveRequirementMetrics(req,works).progress).toBe(60);
});
