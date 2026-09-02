import type { Session } from './types';

export const isAdmin = (session: Session) => session.globalRole === 'admin';
export const canManageProject = (session: Session, projectId: string) =>
  isAdmin(session) || session.managedProjectIds.includes(projectId);
