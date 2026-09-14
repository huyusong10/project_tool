import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
const preview = path.resolve('.preview'), settings = JSON.parse(fs.readFileSync(path.join(preview, 'preview-env.json'), 'utf8'));
if (!path.resolve(settings.DB_PATH).startsWith(preview + path.sep) || settings.SESSION_COOKIE_NAME !== 'pm_workspace_3270') throw new Error('示例仅写入隔离预览数据库');
Object.assign(process.env, settings);
const { buildApp } = await import('../src/server/app.ts'), { sqlite } = await import('../src/server/database.ts');
// Only the copied preview administrator receives this local preview password.
const {hashPassword}=await import('../src/server/auth.ts');
sqlite.prepare('UPDATE accounts SET password_hash=?,must_change_password=0,session_version=session_version+1 WHERE is_builtin=1').run(hashPassword(settings.ADMIN_PASSWORD));
const app = await buildApp(); await app.ready();
const login = await app.inject({ method: 'POST', url: '/api/login', payload: { username: 'admin', password: settings.ADMIN_PASSWORD } });
const cookie = String(login.headers['set-cookie']).split(';')[0];
async function post(url, payload) { const response = await app.inject({ method: 'POST', url, headers: { cookie }, payload }); if (response.statusCode !== 200) throw new Error(response.body); return response.json(); }
try {
  const name = '【工作区预览】DCIM 分期交付';
  if (sqlite.prepare('SELECT 1 FROM projects WHERE name=?').get(name)) { console.log('预览示例已存在，保留已做的演示操作'); }
  else {
    const project = await post('/api/projects', { name }), base = '/api/projects/' + project.id;
    const feature = (await post(base + '/features', { name: '资产管理', description: '逐步建立资产台账、生命周期管理和跨站点资产治理。', referenceLinks: [{ title: 'MPS／MDS 文档（示例）', url: 'https://example.com/dcim/asset-design' }] })).features[0];
    const phases = [];
    for (const value of [ { name: 'Phase 1', scope: '资产台账、分类和基础查询', targetDate: '2026-09-11' }, { name: 'Phase 2', scope: '资产导入与生命周期管理', targetDate: '2026-09-25', note: '导入格式需要与现场数据确认' }, { name: 'Phase 3', scope: '', targetDate: null } ]) phases.push(await post(base + '/features/' + feature.id + '/phases', value));
    const now = new Date().toISOString();
    function requirement(title, phaseId, status, works = []) {
      const id = randomUUID(), terminal = status === 'completed';
      sqlite.prepare('INSERT INTO requirements(id,project_id,feature_id,phase_id,title,background,acceptance_criteria,status,execution_mode,progress,planned_start,planned_end,actual_start,actual_end,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id, project.id, feature.id, phaseId, title, '仅用于验证页面的示例数据', '按本条需求约定的功能范围完成', status, works.length ? 'work_items' : 'direct', terminal ? 100 : status === 'in_progress' ? 50 : 0, '2026-09-07', terminal ? '2026-09-11' : '2026-09-25', status === 'not_started' ? null : '2026-09-07', terminal ? '2026-09-11' : null, now, now);
      for (const w of works) sqlite.prepare('INSERT INTO work_items(id,requirement_id,title,work_stage,status,progress,progress_weight,duration_days,planned_start,planned_end,actual_start,actual_end,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(randomUUID(), id, w.title, w.stage || null, w.status, w.progress, w.weight || 1, w.weight || 1, '2026-09-07', '2026-09-25', w.status === 'not_started' ? null : '2026-09-07', w.status === 'completed' ? '2026-09-11' : null, now, now);
      return id;
    }
    requirement('DCIM-DEMO-001 基础资产台账', phases[0].id, 'completed');
    const testing = requirement('DCIM-DEMO-002 资产导入', phases[1].id, 'in_progress', [{ title: '导入开发', stage: 'development', status: 'completed', progress: 100, weight: 99 }, { title: '测试验收', stage: 'testing', status: 'in_progress', progress: 70 }]);
    const parallel = requirement('DCIM-DEMO-003 生命周期管理', phases[1].id, 'in_progress', [{ title: '退役流程开发', stage: 'development', status: 'in_progress', progress: 60 }, { title: '入库流程测试', stage: 'testing', status: 'in_progress', progress: 30 }]);
    requirement('DCIM-DEMO-004 外部资料对齐', phases[1].id, 'in_progress', [{ title: '与现场对齐字段', status: 'in_progress', progress: 40 }]);
    requirement('DCIM-DEMO-005 深水区探索', null, 'not_started');
    await post(base + '/feature-phases/' + phases[0].id + '/deliver', { expectedVersion: phases[0].version, deliveredAt: '2026-09-11' });
    await post(base + '/features', { name: '告警管理', description: '告警规则与通知策略，范围随试用反馈调整。' });
    const report = { projectId: project.id, featureId: feature.id, testingRequirementId: testing, parallelRequirementId: parallel, phaseIds: phases.map(p => p.id) };
    fs.writeFileSync(path.join(preview, 'demo-scenarios.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
  }
} finally { await app.close(); sqlite.close(); }

