// Compatibility type exports; transport DTOs are shared with the server.
export type * from '../shared/api/accounts';
export type * from '../shared/api/projects';
export type * from '../shared/api/people';
export type * from '../shared/api/templates';
export type * from '../shared/api/requirements';
export type * from '../shared/api/work-items';
export type * from '../shared/api/progress';
export type * from '../shared/api/issues';
export type * from '../shared/api/reporting';
export type * from '../shared/api/archives';
export type * from '../shared/api/tokens';
export type * from '../shared/api/audit';
export type * from '../shared/api/system';
export type * from '../shared/action-items';

export type ProjectPermission = {
  canRead: boolean;
  canContribute: boolean;
  canManage: boolean;
};
