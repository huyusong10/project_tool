import type { Page } from '@playwright/test';
import { emptyWorkspace } from './empty-workspace';
export const project = { id: 'p1', name: '测试项目', status: 'active', plannedStart: null, plannedEnd: null, defaultTemplateId: 't1', isSample: false, createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z' };

export const template = { id: 't1', projectId: 'p1', name: '测试流程', description: '原说明', createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z', items: [
  { id: 'ti1', templateId: 't1', title: '设计', startOffsetDays: 0, durationDays: 2, milestoneLabel: null, sortOrder: 0 },
  { id: 'ti2', templateId: 't1', title: '开发', startOffsetDays: 2, durationDays: 3, milestoneLabel: '发布基线', sortOrder: 1 },
] };

export const secondaryTemplate = { ...template, id: 't2', name: '备用流程', items: template.items.map((item) => ({ ...item, id: `${item.id}-secondary`, templateId: 't2' })) };

export const people = [
  { id: 'u1', name: '负责人', active: 1, projectRole: 'member' },
  { id: 'u2', name: '备用负责人', active: 1, projectRole: 'member' },
];

export interface FormReferenceState {
  templates: (typeof template)[];
  people: typeof people;
  templateRequests: number;
  peopleRequests: number;
}

export async function mockForms(page: Page, references?: FormReferenceState) {
  await page.route('**/api/**', async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === '/api/session') return route.fulfill({ json: { authenticated: true, accountId: 'admin', username: 'admin', role: 'admin', globalRole: 'admin', personId: null, mustChangePassword: false, managedProjectIds: [] } });
    if (pathname === '/api/branding') return route.fulfill({ json: { systemName: '项目管理', shortName: 'PM', logoUrl: null } });
    if (pathname === '/api/projects') return route.fulfill({ json: [project] });
    if (pathname.endsWith('/path-graph')) return route.fulfill({ json: { analysis: emptyWorkspace(project).analysis } });
    if (pathname === '/api/dashboard') return route.fulfill({ json: emptyWorkspace(project).report });
    if (pathname.endsWith('/requirement-intake')) return route.fulfill({ json: { features: [] } });
    if (pathname === '/api/templates') {
      if (references) references.templateRequests += 1;
      return route.fulfill({ json: references?.templates || [template] });
    }
    if (pathname === '/api/people') {
      if (references) references.peopleRequests += 1;
      return route.fulfill({ json: references?.people || people.slice(0, 1) });
    }
    if (pathname === '/api/archives') return route.fulfill({ json: { projects: [], requirements: [], templates: [], people: [] } });
    return route.fulfill({ json: [] });
  });
}

export const scenarios = [
  { name: '新建项目', path: '/projects', trigger: '新建项目', endpoint: '/api/projects', method: 'POST', kind: 'project', field: '项目名称', submit: '创建项目' },
  { name: '编辑项目', path: '/project-settings', trigger: '编辑项目', endpoint: '/api/projects/p1', method: 'PATCH', kind: 'project', field: '项目名称', submit: '保存修改' },
  { name: '新建需求', path: '/requirements', trigger: '新建需求', endpoint: '/api/requirements', method: 'POST', kind: 'requirement', field: '需求标题', submit: '创建需求' },
  { name: '新建流程', path: '/templates', trigger: '新建流程', endpoint: '/api/templates', method: 'POST', kind: 'template', field: '流程名称', submit: '保存修改' },
  { name: '编辑流程', path: '/templates', trigger: '编辑流程 测试流程', endpoint: '/api/templates/t1', method: 'PATCH', kind: 'template', field: '流程名称', submit: '保存修改' },
] as const;
