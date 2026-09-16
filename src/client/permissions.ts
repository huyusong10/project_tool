import type {Session,Person,Requirement,WorkItem,Project} from './types';

export const isGuestWorkspace = (session: Session, project?: Project) => !session.authenticated || Boolean(project?.publicReadOnly);

export const isAdmin = (session: Session) => session.globalRole === 'admin';
export const canManageProject = (session: Session, projectId: string) =>
  isAdmin(session) || session.managedProjectIds.includes(projectId);

export function workExecutionAccess(session:Session,r:Requirement,item:WorkItem,people:Person[]){
  const manager=session.authenticated&&canManageProject(session,r.projectId),role=people.find(p=>p.id===session.personId)?.projectRole;
  const member=session.authenticated&&(manager||role==='member'||role==='manager');
  const owner=member&&!!session.personId&&r.ownerId===session.personId;
  const assigned=member&&!!session.personId&&!!item.assigneeIds?.includes(session.personId);
  return {manager,owner,operate:!r.deletedAt&&(manager||r.status!=='cancelled'&&(owner||assigned)),
    progress:!r.deletedAt&&!['pending_acceptance','completed','cancelled'].includes(r.status)&&item.status==='in_progress'&&(manager||owner||assigned)};
}
