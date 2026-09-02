import { check, index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

const timestamps = {
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
};

export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  status: text('status').notNull().default('active'),
  plannedStart: text('planned_start'),
  plannedEnd: text('planned_end'),
  defaultTemplateId: text('default_template_id'),
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

export const projectPeople = sqliteTable('project_people', {
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  personId: text('person_id').notNull().references(() => people.id, { onDelete: 'cascade' }),
  createdAt: text('created_at').notNull(),
}, (table) => [
  primaryKey({ columns: [table.projectId, table.personId] }),
  index('idx_project_people_person').on(table.personId, table.projectId),
]);

export const workItemTemplates = sqliteTable('work_item_templates', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  ...timestamps,
  deletedAt: text('deleted_at'),
}, (table) => [index('idx_templates_deleted_at').on(table.deletedAt)]);

export const templateItems = sqliteTable('template_items', {
  id: text('id').primaryKey(),
  templateId: text('template_id').notNull().references(() => workItemTemplates.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
  startOffsetDays: integer('start_offset_days').notNull().default(0),
  durationDays: integer('duration_days').notNull().default(1),
  deletedAt: text('deleted_at'),
}, (table) => [
  check('template_items_offset_nonnegative', sql`${table.startOffsetDays} >= 0`),
  check('template_items_duration_positive', sql`${table.durationDays} >= 1`),
  index('idx_template_items_template_order').on(table.templateId, table.deletedAt, table.sortOrder),
]);

export const requirements = sqliteTable('requirements', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id),
  title: text('title').notNull(),
  ownerId: text('owner_id').references(() => people.id),
  status: text('status').notNull().default('planning'),
  plannedStart: text('planned_start'),
  plannedEnd: text('planned_end'),
  progress: integer('progress').notNull().default(0),
  riskLevel: text('risk_level').notNull().default('low'),
  priority: text('priority').notNull().default('P2'),
  ...timestamps,
  deletedAt: text('deleted_at'),
}, (table) => [
  check('requirements_progress_range', sql`${table.progress} >= 0 AND ${table.progress} <= 100`),
  index('idx_requirements_project_status').on(table.projectId, table.status, table.deletedAt),
  index('idx_requirements_owner').on(table.ownerId),
]);

export const workItems = sqliteTable('work_items', {
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
  blockedAt: text('blocked_at'),
  blockedReason: text('blocked_reason'),
  sortOrder: integer('sort_order').notNull().default(0),
  ...timestamps,
}, (table) => [
  index('idx_work_items_requirement_order').on(table.requirementId, table.sortOrder),
  index('idx_work_items_status').on(table.status),
  index('idx_work_items_owner_schedule').on(table.ownerId, table.plannedStart, table.plannedEnd),
]);

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
  content: text('content').notNull(),
  ...timestamps,
}, (table) => [
  check('progress_updates_percent_range', sql`${table.percent} >= 0 AND ${table.percent} <= 100`),
  index('idx_progress_requirement_created').on(table.requirementId, table.createdAt),
]);

export const apiTokens = sqliteTable('api_tokens', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  prefix: text('prefix').notNull(),
  tokenHash: text('token_hash').notNull(),
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
  summary: text('summary').notNull(),
  createdAt: text('created_at').notNull(),
}, (table) => [index('idx_audit_created_at').on(table.createdAt)]);
