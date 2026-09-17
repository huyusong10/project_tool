import { issueStatuses, priorities, requirementStatuses, riskLevels, workItemStatuses } from '../shared/domain';
// Compatibility exports for existing scripts and consumers. Domain code imports its owner directly.
export { getRequirement, listRequirements } from './services/requirements';
export type { RequirementRecord, WorkItemRecord } from './services/requirements';
export { listAudit, recordAudit, searchAudit } from './services/audit';
export {
  addIssueUpdate,
  correctIssue,
  createIssue,
  deferIssue,
  deleteIssueUpdate,
  getIssue,
  listIssues,
  reopenIssue,
  resolveIssue,
  resumeIssue,
  updateIssue,
  updateIssueUpdate,
} from './services/issues';
export type { IssueRecord, IssueUpdateRecord } from './services/issues';
export { authenticateApiToken, issueToken, listTokens, revokeToken } from './services/tokens';
export { getDashboard, getPeopleConcurrency } from './services/reporting';
export { listActionItems } from './services/actions';
export { issueStatuses, priorities, requirementStatuses, riskLevels, workItemStatuses };
export { ProjectRecord, listProjects, listWorkspaceProjects, createProject, updateProject, archiveProject, restoreProject } from './services/projects';
export { listTemplates, createTemplate, updateTemplate, copyTemplate, archiveTemplate, restoreTemplate } from './services/templates';
export { listPeople, listPeopleCandidates, addProjectPerson, removeProjectPerson, createPerson, updatePerson, archivePerson, restorePerson } from './services/people';
export { createRequirement, updateRequirement, correctRequirement, rescheduleRequirement, reselectRequirementTemplate, archiveRequirement, acceptRequirement, cancelRequirement, restoreRequirement, applyTemplate, previewRequirementPlan, applyRequirementPlan } from './services/requirement-commands';
export { reopenRequirementForMilestone } from './services/requirement-events';
export { createWorkItem, updateWorkItem, startWorkItem, completeWorkItem, blockWorkItem, unblockWorkItem, cancelWorkItem, reopenWorkItem, correctWorkItem, deleteWorkItem, reorderWorkItems } from './services/work-items';
export { completeWorkItemAsPlanned, completeRequirementAsPlanned } from './services/planned-completion';
export { addProgress, updateProgress, deleteProgress } from './services/progress';
export { listArchives, ArchiveEntity, permanentlyDeleteArchive } from './services/archives';
