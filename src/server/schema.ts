import { check, index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

const timestamps = {
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
};

export const systemMeta = sqliteTable('system_meta', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  status: text('status').notNull().default('active'),
  plannedStart: text('planned_start'),
  plannedEnd: text('planned_end'),
  defaultTemplateId: text('default_template_id'),
  guestVisible: integer('guest_visible', { mode: 'boolean' }).notNull().default(false),
  analysisRevision: integer('analysis_revision').notNull().default(0),
  ...timestamps,
  deletedAt: text('deleted_at'),
}, (table) => [index('idx_projects_deleted_at').on(table.deletedAt)]);

export const people = sqliteTable('people', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  jobTitle: text('job_title'),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  ...timestamps,
  deletedAt: text('deleted_at'),
}, (table) => [
  index('idx_people_active').on(table.active, table.deletedAt),
  uniqueIndex('idx_people_active_name_unique')
    .on(sql`lower(trim(${table.name}))`)
    .where(sql`${table.deletedAt} IS NULL`),
]);

export const accounts = sqliteTable('accounts', {
  id: text('id').primaryKey(),
  username: text('username').notNull(),
  normalizedUsername: text('normalized_username').notNull(),
  passwordHash: text('password_hash').notNull(),
  personId: text('person_id').references(() => people.id, { onDelete: 'set null' }),
  globalRole: text('global_role').notNull().default('user'),
  status: text('status').notNull().default('active'),
  mustChangePassword: integer('must_change_password', { mode: 'boolean' }).notNull().default(true),
  sessionVersion: integer('session_version').notNull().default(0),
  isBuiltin: integer('is_builtin', { mode: 'boolean' }).notNull().default(false),
  lastLoginAt: text('last_login_at'),
  ...timestamps,
  deletedAt: text('deleted_at'),
}, (table) => [
  uniqueIndex('idx_accounts_normalized_username').on(table.normalizedUsername),
  uniqueIndex('idx_accounts_person').on(table.personId),
  index('idx_accounts_status_role').on(table.status, table.globalRole),
  index('idx_accounts_deleted_at').on(table.deletedAt),
  check('accounts_role_valid', sql`${table.globalRole} IN ('user', 'admin')`),
  check('accounts_status_valid', sql`${table.status} IN ('active', 'disabled')`),
]);

export const analyticsLayouts = sqliteTable('analytics_layouts', {
  accountId: text('account_id').primaryKey().references(() => accounts.id, { onDelete: 'cascade' }),
  configJson: text('config_json').notNull(),
  ...timestamps,
});

export const projectPeople = sqliteTable('project_people', {
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  personId: text('person_id').notNull().references(() => people.id, { onDelete: 'cascade' }),
  projectRole: text('project_role').notNull().default('member'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at'),
}, (table) => [
  primaryKey({ columns: [table.projectId, table.personId] }),
  index('idx_project_people_person').on(table.personId, table.projectId),
  index('idx_project_people_role').on(table.projectId, table.projectRole),
  check('project_people_role_valid', sql`${table.projectRole} IN ('viewer', 'member', 'manager')`),
]);

export const workItemTemplates = sqliteTable('work_item_templates', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  dependencyMode: text('dependency_mode').notNull().default('legacy'),
  ...timestamps,
  deletedAt: text('deleted_at'),
}, (table) => [
  index('idx_templates_project_deleted').on(table.projectId, table.deletedAt),
  uniqueIndex('idx_templates_project_active_name_unique')
    .on(table.projectId, sql`lower(trim(${table.name}))`)
    .where(sql`${table.deletedAt} IS NULL`),
]);

export const templateItems = sqliteTable('template_items', {
  workStage: text('work_stage'), milestoneKind: text('milestone_kind').notNull().default('ordinary'),
  id: text('id').primaryKey(),
  templateId: text('template_id').notNull().references(() => workItemTemplates.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
  startOffsetDays: integer('start_offset_days').notNull().default(0),
  durationDays: integer('duration_days').notNull().default(1),
  milestoneLabel: text('milestone_label'),
  kind: text('kind').notNull().default('work'),
  arrangement: text('arrangement').notNull().default('early'),
  arrangementAnchor: text('arrangement_anchor'),
  confirmationMode: text('confirmation_mode').notNull().default('auto'),
  predecessorIds: text('predecessor_ids').notNull().default('[]'),
  deletedAt: text('deleted_at'),
}, (table) => [
  check('template_items_offset_nonnegative', sql`${table.startOffsetDays} >= 0`),
  check('template_items_duration_positive', sql`(${table.kind}='work' AND ${table.durationDays}>=1) OR (${table.kind}='milestone' AND ${table.durationDays}=0)`),
  index('idx_template_items_template_order').on(table.templateId, table.deletedAt, table.sortOrder),
]);

export const requirements = sqliteTable('requirements', {
  referenceLinks: text('reference_links').notNull().default('[]'),
  sourceNotes: text('source_notes'),
  sortOrder: integer('sort_order').notNull().default(-1),
  featureId: text('feature_id').references(() => features.id, { onDelete: 'set null' }),
  phaseId: text('phase_id').references(() => featurePhases.id), stageResetAt: text('stage_reset_at'),
  forecastDuration: integer('forecast_duration'),
  forecastReadyAt: text('forecast_ready_at'),
  deliveryScope: text('delivery_scope').notNull().default('committed'),
  executionMode: text('execution_mode').notNull().default('work_items'),
  acceptanceOwnerId: text('acceptance_owner_id').references(() => people.id),
  actualStart: text('actual_start'),
  actualEnd: text('actual_end'),
  blockedAt: text('blocked_at'),
  blockedReason: text('blocked_reason'),
  forecastReview: text('forecast_review'),
  blockedCoordinatorId: text('blocked_coordinator_id').references(() => people.id),
  blockedNextReviewAt: text('blocked_next_review_at'),
  blockedIssueId: text('blocked_issue_id'),
  durationDays: integer('duration_days'),
  forecastEnd: text('forecast_end'),
  unblockEstimate: text('unblock_estimate'),
  splitBaseProgress: integer('split_base_progress').notNull().default(0),
  splitAt: text('split_at'),
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id),
  templateId: text('template_id').references(() => workItemTemplates.id, { onDelete: 'set null' }),
  title: text('title').notNull(),
  background: text('background'),
  acceptanceCriteria: text('acceptance_criteria'),
  referenceUrl: text('reference_url'),
  ownerId: text('owner_id').references(() => people.id),
  status: text('status').notNull().default('not_started'),
  plannedStart: text('planned_start'),
  plannedEnd: text('planned_end'),
  progress: integer('progress').notNull().default(0),
  riskLevel: text('risk_level').notNull().default('low'),
  priority: text('priority').notNull().default('P2'),
  dependenciesReviewedAt: text('dependencies_reviewed_at'),
  scheduleAnchor: text('schedule_anchor'),
  forecastAcceptance: text('forecast_acceptance'),
  acknowledgedDependencies: text('acknowledged_dependencies').notNull().default('[]'),
  acceptedAt: text('accepted_at'),
  acceptedByAccountId: text('accepted_by_account_id').references(() => accounts.id, { onDelete: 'set null' }),
  version: integer('version').notNull().default(1),
  ...timestamps,
  deletedAt: text('deleted_at'),
}, (table) => [
  check('requirements_progress_range', sql`${table.progress} >= 0 AND ${table.progress} <= 100`),
  check('requirements_status_valid', sql`${table.status} IN ('not_started', 'in_progress', 'completed', 'cancelled')`),
  check('requirements_terminal_consistent', sql`(
    (${table.status} = 'completed' AND ${table.progress} = 100) OR
    (${table.status} <> 'completed' AND ${table.progress} < 100)
  )`),
  index('requirements_group').on(table.featureId),
  index('requirements_outline_order').on(table.projectId,table.featureId,table.phaseId,table.sortOrder),
  index('idx_requirements_project_status').on(table.projectId, table.status, table.deletedAt),
  index('idx_requirements_template').on(table.templateId),
  index('idx_requirements_owner').on(table.ownerId),
]);

export const workItems = sqliteTable('work_items', {
  referenceLinks: text('reference_links').notNull().default('[]'),
  workStage: text('work_stage'),
  progressWeight: integer('progress_weight'),
  id: text('id').primaryKey(),
  requirementId: text('requirement_id').notNull().references(() => requirements.id, { onDelete: 'cascade' }),
  templateItemId: text('template_item_id').references(() => templateItems.id),
  title: text('title').notNull(),
  ownerId: text('owner_id').references(() => people.id),
  status: text('status').notNull().default('not_started'),
  plannedStart: text('planned_start'),
  plannedEnd: text('planned_end'),
  actualStart: text('actual_start'),
  actualEnd: text('actual_end'),
  forecastEnd: text('forecast_end'),
  durationDays: integer('duration_days'),
  arrangement: text('arrangement').notNull().default('early'),
  arrangementAnchor: text('arrangement_anchor'),
  acknowledgedDependencies: text('acknowledged_dependencies').notNull().default('[]'),
  earliestStart: text('earliest_start'),
  unblockEstimate: text('unblock_estimate'),
  forecastDuration: integer('forecast_duration'),
  forecastReadyAt: text('forecast_ready_at'),
  blockedAt: text('blocked_at'),
  blockedReason: text('blocked_reason'),
  forecastReview: text('forecast_review'),
  blockedCoordinatorId: text('blocked_coordinator_id').references(() => people.id),
  blockedNextReviewAt: text('blocked_next_review_at'),
  blockedIssueId: text('blocked_issue_id'),
  milestoneLabel: text('milestone_label'),
  progress: integer('progress').notNull().default(0),
  sortOrder: integer('sort_order').notNull().default(0),
  version: integer('version').notNull().default(1),
  ...timestamps,
}, (table) => [
  check('work_items_progress_range', sql`${table.progress} >= 0 AND ${table.progress} <= 100`),
  check('work_items_status_valid', sql`${table.status} IN ('not_started', 'in_progress', 'completed', 'cancelled')`),
  check('work_items_state_consistent', sql`(
    (${table.status} = 'not_started' AND ${table.progress} = 0 AND ${table.actualStart} IS NULL AND ${table.actualEnd} IS NULL AND ${table.blockedAt} IS NULL) OR
    (${table.status} = 'in_progress' AND ${table.progress} < 100 AND ${table.actualStart} IS NOT NULL AND ${table.actualEnd} IS NULL AND ${table.blockedAt} IS NULL) OR
    (${table.status} = 'completed' AND ${table.progress} = 100 AND ${table.actualStart} IS NOT NULL AND ${table.actualEnd} IS NOT NULL AND ${table.blockedAt} IS NULL) OR
    (${table.status} = 'cancelled' AND ${table.progress} < 100 AND ${table.actualEnd} IS NULL AND ${table.blockedAt} IS NULL)
  )`),
  index('idx_work_items_requirement_order').on(table.requirementId, table.sortOrder),
  index('idx_work_items_status').on(table.status),
  index('idx_work_items_owner_schedule').on(table.ownerId, table.plannedStart, table.plannedEnd),
]);

export const dependencyEdges = sqliteTable('dependency_edges', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  sourceRequirementId: text('source_requirement_id').references(() => requirements.id),
  sourceWorkItemId: text('source_work_item_id').references(() => workItems.id),
  targetRequirementId: text('target_requirement_id').references(() => requirements.id),
  targetWorkItemId: text('target_work_item_id').references(() => workItems.id),
  sourceMilestoneId: text('source_milestone_id').references(() => milestones.id),
  targetMilestoneId: text('target_milestone_id').references(() => milestones.id),
  origin: text('origin').notNull().default('manual'),
  ...timestamps,
}, (table) => [
  index('idx_dependency_project').on(table.projectId),
  index('idx_dependency_target').on(table.targetRequirementId),
  index('idx_dependency_source').on(table.sourceRequirementId),
  uniqueIndex('idx_dependency_endpoints').on(sql`coalesce(source_requirement_id, '')`, sql`coalesce(source_work_item_id, '')`,sql`coalesce(source_milestone_id, '')`,sql`coalesce(target_requirement_id, '')`, sql`coalesce(target_work_item_id, '')`,sql`coalesce(target_milestone_id, '')`),
]);

export const jiraConnections = sqliteTable('jira_connections', {
  accountId: text('account_id').primaryKey().references(() => accounts.id, { onDelete: 'cascade' }),
  site: text('site').notNull(), encryptedToken: text('encrypted_token').notNull(), version: text('version').notNull(),
  verifiedAt: text('verified_at'), identity: text('identity'), problem: text('problem'), updatedAt: text('updated_at').notNull(),
});
export const jiraProjectSettings = sqliteTable('jira_project_settings', {
  projectId: text('project_id').primaryKey().references(() => projects.id, { onDelete: 'cascade' }),
  settings: text('settings').notNull(), version: integer('version').notNull().default(1),
});
export const jiraBindings = sqliteTable('jira_bindings', {
  requirementId: text('requirement_id').primaryKey().references(() => requirements.id),
  projectId: text('project_id').notNull().references(() => projects.id),
  site: text('site').notNull(), issueId: text('issue_id').notNull(), issueKey: text('issue_key').notNull(),
  createdBy: text('created_by').notNull(), createdAt: text('created_at').notNull(),
}, table => [uniqueIndex('jira_bindings_site_issue').on(table.site, table.issueId)]);
export const jiraIgnored = sqliteTable('jira_ignored', {
  projectId: text('project_id').notNull().references(() => projects.id), site: text('site').notNull(), issueKey: text('issue_key').notNull(),
}, table => [primaryKey({ columns: [table.projectId, table.site, table.issueKey] })]);
export const jiraReferenceOnly = sqliteTable('jira_reference_only', {
  requirementId: text('requirement_id').notNull().references(() => requirements.id, { onDelete: 'cascade' }),
  site: text('site').notNull(), issueId: text('issue_id').notNull(),
}, table => [primaryKey({ columns: [table.requirementId, table.site, table.issueId] })]);
export const jiraOperations = sqliteTable('jira_operations', {
  id: text('id').primaryKey(), accountId: text('account_id').notNull().references(() => accounts.id, { onDelete: 'cascade' }),
  projectId: text('project_id').notNull().references(() => projects.id), credentialVersion: text('credential_version').notNull(),
  kind: text('kind').notNull(), state: text('state').notNull(), payload: text('payload').notNull(),
  createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(),
}, table => [index('jira_operations_owner').on(table.accountId, table.projectId, table.kind)]);

export const milestones=sqliteTable('milestones',{
  milestoneKind:text('milestone_kind').notNull().default('ordinary'), achievedRecordedAt:text('achieved_recorded_at'),
  id:text('id').primaryKey(),projectId:text('project_id').notNull().references(()=>projects.id),
  requirementId:text('requirement_id').references(()=>requirements.id),templateItemId:text('template_item_id').references(()=>templateItems.id),
  title:text('title').notNull(),targetDate:text('target_date'),confirmationMode:text('confirmation_mode').notNull().default('auto'),
  achievedAt:text('achieved_at'),achievedBy:text('achieved_by').references(()=>accounts.id),cancelled:integer('cancelled',{mode:'boolean'}).notNull().default(false),
  legacyWorkItemId:text('legacy_work_item_id').unique().references(()=>workItems.id),version:integer('version').notNull().default(1),...timestamps,
},table=>[index('idx_milestones_project').on(table.projectId),index('idx_milestones_requirement').on(table.requirementId)]);

export const diagramLayouts=sqliteTable('diagram_layouts',{
  projectId:text('project_id').notNull().references(()=>projects.id),scope:text('scope').notNull(),direction:text('direction').notNull(),
  positions:text('positions').notNull().default('{}'),version:integer('version').notNull().default(1),updatedAt:text('updated_at').notNull(),
},table=>[primaryKey({columns:[table.projectId,table.scope,table.direction]})]);

export const workItemCollaborators = sqliteTable('work_item_collaborators', {
  workItemId: text('work_item_id').notNull().references(() => workItems.id, { onDelete: 'cascade' }),
  personId: text('person_id').notNull().references(() => people.id, { onDelete: 'cascade' }),
}, (table) => [
  primaryKey({ columns: [table.workItemId, table.personId] }),
  index('idx_work_item_collaborators_person').on(table.personId, table.workItemId),
]);

export const progressUpdates = sqliteTable('progress_updates', {
  id: text('id').primaryKey(),
  requirementId: text('requirement_id').notNull().references(() => requirements.id, { onDelete: 'cascade' }),
  workItemId: text('work_item_id').references(() => workItems.id, { onDelete: 'set null' }),
  percent: integer('percent').notNull(),
  workItemPercent: integer('work_item_percent'),
  content: text('content').notNull(),
  eventType: text('event_type').notNull().default('progress'),
  supersedesId: text('supersedes_id'),
  createdByAccountId: text('created_by_account_id').references(() => accounts.id, { onDelete: 'set null' }),
  ...timestamps,
}, (table) => [
  check('progress_updates_percent_range', sql`${table.percent} >= 0 AND ${table.percent} <= 100`),
  check('progress_updates_work_item_percent_range', sql`${table.workItemPercent} IS NULL OR (${table.workItemPercent} >= 0 AND ${table.workItemPercent} <= 100)`),
  index('idx_progress_requirement_created').on(table.requirementId, table.createdAt),
]);

export const issues = sqliteTable('issues', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  requirementId: text('requirement_id').references(() => requirements.id, { onDelete: 'set null' }),
  sourceRef: text('source_ref'),
  nextReviewAt: text('next_review_at'),
  title: text('title').notNull(),
  impact: text('impact'),
  reporter: text('reporter'),
  ownerId: text('owner_id').references(() => people.id, { onDelete: 'set null' }),
  status: text('status').notNull().default('in_progress'),
  priority: text('priority').notNull().default('P2'),
  progress: integer('progress').notNull().default(0),
  discoveredAt: text('discovered_at').notNull(),
  dueDate: text('due_date'),
  resolvedAt: text('resolved_at'),
  version: integer('version').notNull().default(1),
  ...timestamps,
}, (table) => [
  check('issues_status_valid', sql`${table.status} IN ('in_progress', 'deferred', 'resolved')`),
  check('issues_priority_valid', sql`${table.priority} IN ('P0', 'P1', 'P2', 'P3')`),
  check('issues_progress_range', sql`${table.progress} >= 0 AND ${table.progress} <= 100`),
  check('issues_state_consistent', sql`(
    (${table.status} = 'resolved' AND ${table.progress} = 100 AND ${table.resolvedAt} IS NOT NULL) OR
    (${table.status} <> 'resolved' AND ${table.progress} < 100 AND ${table.resolvedAt} IS NULL)
  )`),
  check('issues_deferred_without_due_date', sql`${table.status} <> 'deferred' OR ${table.dueDate} IS NULL`),
  index('idx_issues_project_status_due').on(table.projectId, table.status, table.dueDate, table.updatedAt),
  index('idx_issues_owner').on(table.ownerId, table.status),
  index('idx_issues_requirement').on(table.requirementId),
]);

export const issueUpdates = sqliteTable('issue_updates', {
  id: text('id').primaryKey(),
  issueId: text('issue_id').notNull().references(() => issues.id, { onDelete: 'cascade' }),
  progress: integer('progress'),
  content: text('content').notNull(),
  eventType: text('event_type').notNull().default('progress'),
  supersedesId: text('supersedes_id'),
  createdByAccountId: text('created_by_account_id').references(() => accounts.id, { onDelete: 'set null' }),
  ...timestamps,
}, (table) => [
  check('issue_updates_progress_range', sql`${table.progress} IS NULL OR (${table.progress} >= 0 AND ${table.progress} <= 100)`),
  index('idx_issue_updates_issue_created').on(table.issueId, table.createdAt),
]);

export const apiTokens = sqliteTable('api_tokens', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  prefix: text('prefix').notNull(),
  tokenHash: text('token_hash').notNull(),
  accountId: text('account_id').notNull().references(() => accounts.id, { onDelete: 'cascade' }),
  expiresAt: text('expires_at'),
  lastUsedAt: text('last_used_at'),
  revokedAt: text('revoked_at'),
  createdAt: text('created_at').notNull(),
}, (table) => [uniqueIndex('idx_api_tokens_prefix').on(table.prefix)]);

export const auditLogs = sqliteTable('audit_logs', {
  id: text('id').primaryKey(),
  actorType: text('actor_type').notNull(),
  actorId: text('actor_id'),
  action: text('action').notNull(),
  entityType: text('entity_type').notNull(),
  entityId: text('entity_id'),
  projectId: text('project_id').references(() => projects.id, { onDelete: 'set null' }),
  summary: text('summary').notNull(),
  createdAt: text('created_at').notNull(),
}, (table) => [
  index('idx_audit_created_at').on(table.createdAt),
  index('idx_audit_project_created').on(table.projectId, table.createdAt),
]);

export const dependencyChangeReceipts = sqliteTable('dependency_change_receipts', {
  batchId: text('batch_id').primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  actorType: text('actor_type').notNull(),
  actorId: text('actor_id').notNull(),
  contentHash: text('content_hash').notNull(),
  committedRevision: integer('committed_revision').notNull(),
  addedIds: text('added_ids').notNull(),
  createdAt: text('created_at').notNull(),
}, table => [index('idx_dependency_receipt_project').on(table.projectId)]);

export const deliveryCommitments = sqliteTable('delivery_commitments', {id:text('id').primaryKey(),projectId:text('project_id').notNull().references(()=>projects.id),confirmedAt:text('confirmed_at').notNull(),snapshot:text('snapshot').notNull()},t=>[index('delivery_commitments_project_date').on(t.projectId,t.confirmedAt)]);

export const features = sqliteTable('features', {
  kind: text('kind').notNull().default('feature'),
  referenceLinks: text('reference_links').notNull().default('[]'),
  id:text('id').primaryKey(),projectId:text('project_id').notNull().references(()=>projects.id,{onDelete:'cascade'}),name:text('name').notNull(),sortOrder:integer('sort_order').notNull().default(0),version:integer('version').notNull().default(1),...timestamps,
  expectation: text('expectation').notNull().default(''),
  description: text('description').notNull().default(''), archivedAt: text('archived_at'),
  progressSummary: text('progress_summary').notNull().default(''),
  assessment: text('assessment').notNull().default('pending'),
  assessmentNote: text('assessment_note').notNull().default(''),
  assessedAt: text('assessed_at'),
  assessedBy: text('assessed_by').references(() => accounts.id, { onDelete: 'set null' }),
},t=>[uniqueIndex('features_name').on(t.projectId,t.name),uniqueIndex('features_system_other').on(t.projectId).where(sql`${t.kind} = 'other'`),check('features_kind_valid',sql`${t.kind} IN ('feature','other')`)]);
export const featureRelations = sqliteTable('feature_relations', {
  id:text('id').primaryKey(),projectId:text('project_id').notNull().references(()=>projects.id,{onDelete:'cascade'}),
  sourceFeatureId:text('source_feature_id').notNull().references(()=>features.id,{onDelete:'cascade'}),
  targetFeatureId:text('target_feature_id').notNull().references(()=>features.id,{onDelete:'cascade'}),
  note:text('note').notNull().default(''),version:integer('version').notNull().default(1),...timestamps,
},t=>[uniqueIndex('feature_relations_pair').on(t.projectId,t.sourceFeatureId,t.targetFeatureId)]);
export const sourceDocuments=sqliteTable('source_documents',{
  id:text('id').primaryKey(),projectId:text('project_id').notNull().references(()=>projects.id,{onDelete:'cascade'}),key:text('source_key').notNull(),title:text('title').notNull(),url:text('url').notNull(),version:text('source_version').notNull(),complete:integer('complete',{mode:'boolean'}).notNull().default(false),...timestamps,
},t=>[uniqueIndex('source_documents_key').on(t.projectId,t.key)]);
export const sourceClauses=sqliteTable('source_clauses',{
  id:text('id').primaryKey(),documentId:text('document_id').notNull().references(()=>sourceDocuments.id,{onDelete:'cascade'}),key:text('source_key').notNull(),currentRevisionId:text('current_revision_id').notNull(),deferredReason:text('deferred_reason').notNull().default(''),...timestamps,
},t=>[uniqueIndex('source_clauses_key').on(t.documentId,t.key)]);
export const sourceRevisions=sqliteTable('source_revisions',{
  id:text('id').primaryKey(),clauseId:text('clause_id').notNull().references(()=>sourceClauses.id,{onDelete:'cascade'}),documentVersion:text('document_version').notNull(),section:text('section').notNull(),externalId:text('external_id').notNull(),title:text('title').notNull(),content:text('content').notNull(),priority:text('priority').notNull(),createdAt:text('created_at').notNull(),
},t=>[index('source_revisions_clause').on(t.clauseId)]);
export const sourceLinks=sqliteTable('source_links',{
  id:text('id').primaryKey(),clauseId:text('clause_id').notNull().references(()=>sourceClauses.id,{onDelete:'cascade'}),requirementId:text('requirement_id').notNull().references(()=>requirements.id,{onDelete:'cascade'}),workItemId:text('work_item_id').references(()=>workItems.id,{onDelete:'cascade'}),scope:text('scope').notNull(),reviewedRevisionId:text('reviewed_revision_id').notNull().references(()=>sourceRevisions.id),...timestamps,
},t=>[uniqueIndex('source_links_target').on(t.clauseId,t.requirementId,sql`coalesce(${t.workItemId}, '')`),index('source_links_requirement').on(t.requirementId)]);
export const requirementImportReceipts=sqliteTable('requirement_import_receipts',{
  batchId:text('batch_id').primaryKey(),projectId:text('project_id').notNull().references(()=>projects.id,{onDelete:'cascade'}),actorId:text('actor_id').notNull(),contentHash:text('content_hash').notNull(),result:text('result').notNull(),createdAt:text('created_at').notNull(),
});

export const jiraPrs = sqliteTable('jira_prs', {
  id: text('id').primaryKey(), projectId: text('project_id').notNull().references(() => projects.id),
  version: integer('version').notNull().default(1), state: text('state').notNull().default('active'),
  startedAt: text('started_at'), stopRequested: integer('stop_requested').notNull().default(0),
  payload: text('payload').notNull(), ...timestamps,
}, table => [uniqueIndex('jira_pr_one_active').on(table.projectId).where(sql`${table.state} IN ('active','running')`)]);
export const jiraProgressSync = sqliteTable('jira_progress_sync', {
  projectId: text('project_id').notNull().references(() => projects.id),
  progressId: text('progress_id').notNull().references(() => progressUpdates.id, { onDelete: 'cascade' }),
  state: text('state').notNull(), prId: text('pr_id').references(() => jiraPrs.id),
  commentId: text('comment_id'), syncedAt: text('synced_at'), updatedAt: text('updated_at').notNull(),
  manualAccountId: text('manual_account_id'), manualReason: text('manual_reason'), manualUrl: text('manual_url'),
}, table => [primaryKey({ columns: [table.projectId, table.progressId] }), index('jira_progress_sync_pr').on(table.prId, table.state)]);

export const featurePhases = sqliteTable('feature_phases',{referenceLinks:text('reference_links').notNull().default('[]'),id:text('id').primaryKey(),projectId:text('project_id').notNull().references(()=>projects.id),featureId:text('feature_id').notNull().references(()=>features.id),name:text('name').notNull(),scope:text('scope').notNull().default(''),targetDate:text('target_date'),note:text('note').notNull().default(''),sortOrder:integer('sort_order').notNull().default(0),startedAt:text('started_at'),deliveredAt:text('delivered_at'),version:integer('version').notNull().default(1),...timestamps},t=>[uniqueIndex('phase_feature_name').on(t.featureId,t.name)]);
export const phaseDeliveries=sqliteTable('phase_deliveries',{id:text('id').primaryKey(),phaseId:text('phase_id').notNull().references(()=>featurePhases.id),deliveredAt:text('delivered_at').notNull(),deliveredBy:text('delivered_by').references(()=>accounts.id),snapshot:text('snapshot').notNull(),createdAt:text('created_at').notNull(),reopenedAt:text('reopened_at'),reopenReason:text('reopen_reason')});
