import { describe, expect, it } from 'vitest';
import { draftRouteComments, summarizePrComment } from '../src/server/services/jira-pr-comments';
import type { PrSource, PrWork } from '../src/shared/jira-pr';

const at = '2026-08-10T02:00:00Z';
const work: PrWork[] = [{ id: 'dev', title: '开发', stage: 'development', status: 'completed', progress: 100, actualStart: '2026-08-03', actualEnd: '2026-08-07' }, { id: 'test', title: '测试', stage: 'testing', status: 'in_progress', progress: 80, actualStart: '2026-08-07', actualEnd: null }];
const source = (id: string, patch: Partial<PrSource> = {}): PrSource => ({ id, requirementId: 'r', workItemId: 'dev', workItemTitle: '开发', percent: 50, workItemPercent: 50, content: '接口完成，开始联调', eventType: 'progress', createdByName: '张工', createdByAccountId: 'u', createdAt: '2026-08-03T01:00:00Z', updatedAt: '2026-08-03T01:00:00Z', jiraSyncState: 'in_pr', jiraPrId: 'pr', jiraCommentId: null, jiraSyncedAt: null, ...patch });

describe('Jira PR progress summary and complete human comments', () => {
  it('summarizes execution once, preserving each human note including repeated wording', () => {
    const sources = [source('1'), source('2', { workItemPercent: 80, createdAt: '2026-08-03T02:00:00Z' }), source('3', { workItemPercent: 90, content: '仍待联调反馈', createdAt: '2026-08-03T03:00:00Z' })];
    const body = summarizePrComment(work, sources, sources, at);
    expect(body.split('\n\n')[0]).toBe('进展摘要\n2026-08-07 开发已完成。');
    expect(body.match(/接口完成，开始联调/g)).toHaveLength(2);
    expect(body).toContain('仍待联调反馈');
    expect(body).not.toMatch(/90%|80%|50%|工作日|历时|截至|实际开始/);
  });
  it('keeps multiline text, whitespace, URLs, authors and chronological order without paraphrasing', () => {
    const note = '  验证说明：\n- 仍有 2 个问题\n\n请查看 https://example.test/report?q=1\n  保留原有缩进。  ';
    const sources = [source('late', { content: '后续说明', createdByName: '李工', createdAt: '2026-08-04T01:00:00Z' }), source('early', { content: note, eventType: 'note' })];
    const body = summarizePrComment(work, sources, sources, at);
    expect(body).toContain(note); expect(body).toContain('2026-08-03 · 开发 · 张工'); expect(body).toContain('2026-08-04 · 开发 · 李工');
    expect(body.indexOf(note)).toBeLessThan(body.indexOf('后续说明'));
  });
  it('retains blocking, reopening, maintenance and correction comments without inventing resolution', () => {
    const sources = [source('1', { eventType: 'block', content: '发现 10 个 bug' }), source('2', { eventType: 'unblock', content: '收到新版本' }), source('3', { eventType: 'reopen', content: '回归失败' }), source('4', { eventType: 'correction', supersedesId: '1', content: '修正为 12 个 bug' }), source('5', { eventType: 'correction', workItemId: null, workItemTitle: null, content: '修改标题并补充文档链接，交付状态不变。' })];
    const body = summarizePrComment(work, sources, sources, at);
    for (const s of sources) expect(body).toContain(s.content);
    expect(body).toContain('修正 2026-08-03 记录'); expect(body).not.toContain('全部修复');
  });
  it('omits only exact system event text and percentage fallbacks, retaining uncertain or explicitly noted text', () => {
    const automatic = [source('1', { eventType: 'start', content: '开始工作项' }), source('2', { eventType: 'complete', content: '完成工作项' }), source('3', { content: '完成度：20% → 50%' })];
    const body = summarizePrComment(work, automatic, automatic, at);
    expect(body).toBe('进展摘要\n2026-08-07 开发已完成。');
    const notes = [source('a', { eventType: 'note', content: '完成工作项' }), source('b', { eventType: 'note', content: '完成度：20% → 50%' }), source('c', { eventType: 'complete', content: '完成工作项，但仍需验收' }), source('d', { eventType: 'correction', content: '完成工作项' }), source('e', { content: '完成度：20% → 80%' })];
    const full = summarizePrComment(work, notes, notes, at);
    for (const note of notes) expect(full).toContain(note.content);
    expect(full.match(/\n完成工作项\n/g)).toHaveLength(2);
  });
  it('does not truncate long human notes or apply a percentage-based content filter', () => {
    const content = '完成 80%，余下需要确认。\n'.repeat(200);
    const sources = [source('1', { content })];
    expect(summarizePrComment(work, sources, sources, at)).toContain(content);
  });
  it('does not repeat an overview or append transition metadata to substantive comments', () => {
    const target = { id: 'done', name: '完成' };
    expect(summarizePrComment(work, [], [], at, target, '本地：已完成')).toBe('本地：已完成\n拟将 Jira 状态更新为完成。');
    const sources = [source('1')];
    expect(summarizePrComment(work, sources, sources, at, target)).not.toContain('Jira 状态');
    const note = [source('2', { eventType: 'note', workItemId: null, workItemTitle: null })];
    expect(summarizePrComment(work, note, note, at)).not.toContain('进展摘要');
  });
  it('summarizes direct execution without inventing dates or duplicating the requirement title', () => {
    const direct = [{ ...work[0], id: null, title: '很长的需求名称', stage: null, actualEnd: null }];
    const sources = [source('1', { workItemId: null, workItemTitle: null, eventType: 'complete', content: '工作完成' })];
    expect(summarizePrComment(direct, sources, sources, at)).toBe('进展摘要\n需求已完成。');
  });
  it('does not call an entire phase complete when only part of it is complete or selected', () => {
    const parallel = [{ ...work[0], title: '前端开发' }, { ...work[0], id: 'backend', title: '后端开发', status: 'in_progress', progress: 50, actualEnd: null }];
    const sources = [source('1')];
    expect(summarizePrComment(parallel, sources, sources, at)).toContain('2026-08-07 前端开发已完成。');
    parallel[1] = { ...parallel[1], status: 'completed', actualEnd: '2026-08-07' };
    expect(summarizePrComment(parallel, sources, sources, at)).toContain('2026-08-07 前端开发已完成。');
  });
  it('distributes each source ID once across transitions without deduplicating distinct human notes', () => {
    const dev = { id: 'dev', name: '开发' }, testing = { id: 'test', name: '测试' }, done = { id: 'done', name: '完成' };
    const sources = [source('dev-source'), source('test-source', { workItemId: 'test', workItemTitle: '测试', content: '发现缺陷，待修复' }), source('other', { workItemId: null, content: '本次补充链接' })];
    const steps = draftRouteComments(work, [...sources, sources[0]], sources, at, '本地：已完成', [{ id: '1', name: '转测', from: dev, to: testing }, { id: '2', name: '完成', from: testing, to: done }]);
    expect(steps[0].sourceIds).toEqual(['dev-source', 'other']); expect(steps[1].sourceIds).toEqual(['test-source']);
    expect(steps[1].body).not.toContain('接口完成'); expect(steps[0].body).not.toContain('发现缺陷');
    expect(steps[1].body).toContain('测试进行中'); expect(steps[1].body).not.toContain('测试已完成');
  });
  it('keeps ambiguous phase evidence together rather than duplicating it across a route', () => {
    const sources = [source('1')], development = { id: 'dev', name: '开发' };
    const steps = draftRouteComments(work, sources, sources, at, '本地：已完成', [{ id: '1', name: '开发阶段一', from: development, to: { id: 'review', name: '评审' } }, { id: '2', name: '开发阶段二', from: development, to: { id: 'done', name: '完成' } }]);
    expect(steps.flatMap(s => s.sourceIds)).toEqual(['1']); expect(steps[1].body).not.toContain('进展摘要');
  });
  it('reduces DCIM-33 execution events to two milestones while retaining all ten non-stock comments', () => {
    const items: PrWork[] = ['前端开发', '后端开发', '数据开发', '联调', '测试'].map((title, n) => ({ id: String(n), title, stage: n < 3 ? 'development' : n === 3 ? 'integration' : 'testing', status: 'completed', progress: 100, actualStart: '2026-09-02', actualEnd: n === 4 ? '2026-09-11' : '2026-09-08' }));
    const notes = ['已完成界面生成，待联调', '已完成开发，待联调', '数据表设计完成，待反馈修改', '联调中，代码返回后端修改中', '后端已重新提交，重新测试', '发现10个bug，部分文件需要解密', '精简需求描述并补充 Confluence 原文链接，交付状态不变。', '按功能需求统一名称，保留 DCIM 编号', '补齐完成标准，保留原执行和交付状态。', '关联设计文档和已有 Jira 工作项；仅更新链接，保留交付状态。'];
    const sources = notes.map((content, n) => source('note-' + n, { content, workItemId: n < 6 ? String(Math.min(n, 4)) : null, workItemTitle: n < 6 ? items[Math.min(n, 4)].title : null, eventType: n < 6 ? 'progress' : 'correction', createdAt: '2026-09-03T01:00:00Z' }));
    sources.push(...items.map(w => source('complete-' + w.id, { workItemId: w.id, eventType: 'complete', content: '完成工作项', createdAt: w.actualEnd + 'T01:00:00Z' })), source('start-dev', { workItemId: '3', eventType: 'start', content: '开始工作项' }), source('start-test', { workItemId: '4', eventType: 'start', content: '开始工作项' }));
    const body = summarizePrComment(items, sources, sources, '2026-09-22T05:00:00Z');
    expect(sources).toHaveLength(17);
    expect(body.split('\n\n')[0]).toBe('进展摘要\n2026-09-08 开发、联调已完成；2026-09-11 测试已完成。');
    for (const note of notes) expect(body.split(note)).toHaveLength(2);
    expect(body).not.toMatch(/100%|历时|开始工作项|完成工作项|全部修复/);
  });
});
