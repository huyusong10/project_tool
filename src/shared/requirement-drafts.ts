import { z } from 'zod';
import { editorEntityChange, dependencyChanges } from './path-contracts';
import { sourceDocumentInput } from './intake';
import type { DependencyChangePreview } from './path-contracts';

const key = z.string().trim().min(1).max(200);
const text = z.string().max(10000);
// Drafts deliberately accept unfinished business fields; executable facts are not editable here.
export const draftEntity = z.object({
  id: key, entity: z.enum(['requirement', 'work', 'milestone']), requirementId: key.nullable().optional(),
  group: z.string().trim().max(200).optional(),
  data: editorEntityChange.shape.data.unwrap().pick({
    title: true, ownerId: true, assigneeIds: true, acceptanceOwnerId: true, priority: true,
    background: true, acceptanceCriteria: true, deliveryScope: true, tags: true,
    plannedStart: true, plannedEnd: true, durationDays: true, arrangement: true,
    arrangementAnchor: true, targetDate: true, confirmationMode: true,
  }).extend({ title: z.string().trim().max(200).default('') }).default({ title: '' }),
}).strict();
const draftDocument = sourceDocumentInput.extend({
  title: z.string().trim().max(200).default(''),
  url: z.union([z.literal(''), z.url({ protocol: /^https?$/ })]).default(''),
  version: z.string().trim().max(200).default(''),
  clauses: z.array(sourceDocumentInput.shape.clauses.element.extend({title:z.string().trim().max(200).default('')})).max(2000).default([]),
});
export const requirementDraftContent = z.object({
  formatVersion: z.literal(1).default(1),
  documents: z.array(draftDocument).max(50).default([]),
  entities: z.array(draftEntity).max(2000).default([]),
  references: z.array(z.object({entity:z.enum(['requirement','work','milestone']),id:key}).strict()).max(2000).default([]),
  links: z.array(z.object({requirementId:key,workItemId:key.nullable().optional(),document:key,clause:key,scope:text.default(''),reason:text.optional()}).strict()).max(6000).default([]),
  dependencies: dependencyChanges.shape.add,
  templates: z.array(z.object({requirementId:key,templateId:key,version:key,name:z.string(),expandedEntityIds:z.array(key),expandedDependencyIds:z.array(key)}).strict()).max(1000).default([]),
  questions: z.array(z.string().max(2000)).max(200).default([]),
  positions: z.record(key,z.object({x:z.number().finite(),y:z.number().finite()}).strict()).default({}),
}).strict();
export const createDraftInput = z.object({requestId:z.uuid(),projectId:key,title:z.string().trim().max(200).default('未命名方案'),content:requirementDraftContent.default(requirementDraftContent.parse({}))}).strict();
export const updateDraftInput = createDraftInput.omit({projectId:true}).extend({expectedVersion:z.number().int().positive()});
export const draftVersionInput = z.object({expectedVersion:z.number().int().positive()}).strict();
export const closeDraftInput = draftVersionInput.extend({requestId:z.uuid()});
export const publishDraftInput = draftVersionInput.extend({batchId:z.uuid(),projectRevision:z.number().int().nonnegative(),previewToken:key});
export const templateDraftInput = draftVersionInput.extend({requirementId:key,templateId:key,plannedStart:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()});
export const listDraftInput = z.object({projectId:key.optional(),status:z.enum(['draft','published','closed']).optional(),q:z.string().max(200).optional(),page:z.coerce.number().int().min(1).default(1),pageSize:z.coerce.number().int().min(1).max(100).default(30)}).strict();
export type DraftContent = z.infer<typeof requirementDraftContent>;
export type DraftEntity = z.infer<typeof draftEntity>;
export type DraftReceipt = {status:'applied';batchId:string;draftId:string;draftVersion:number;projectId:string;projectRevision:number;ids:Record<string,string>;createdAt:string};
export type RequirementDraft = {
  id:string;accountId:string;projectId:string;title:string;content:DraftContent;version:number;
  status:'draft'|'published'|'closed';source:'web'|'mcp';createdAt:string;updatedAt:string;
  projectAccessible:boolean;canPublish:boolean;receipt:DraftReceipt|null;
};
export type DraftSummary = Omit<RequirementDraft,'content'|'receipt'> & {requirementCount:number;workItemCount:number};
export type DraftPreview = {draftVersion:number;projectRevision:number;previewToken:string;errors:string[];warnings:string[];sourceChanges?:Array<{title:string;before:string;after:string}>;core:DependencyChangePreview|null};
export const emptyDraftContent = ():DraftContent => requirementDraftContent.parse({});
