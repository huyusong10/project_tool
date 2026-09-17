import type { FeatureRelation } from './path-model';
export type { FeatureRelation, FeatureCanvasContext } from './path-model';
import { z } from 'zod';
export const featureRelationInput = z.object({
  id: z.string().min(1).optional(), expectedVersion: z.number().int().positive().optional(),
  sourceFeatureId: z.string().min(1), targetFeatureId: z.string().min(1), note: z.string().trim().max(2000).default(''),
}).strict();

export const featureRelationChange = z.discriminatedUnion('op', [
  featureRelationInput.omit({id:true,expectedVersion:true}).extend({op:z.literal('create'),id:z.string().min(1)}).strict(),
  z.object({op:z.literal('update'),id:z.string().min(1),expectedVersion:z.number().int().positive(),note:z.string().trim().max(2000)}).strict(),
  z.object({op:z.literal('delete'),id:z.string().min(1),expectedVersion:z.number().int().positive()}).strict(),
]);
export type FeatureRelationChange = z.infer<typeof featureRelationChange>;

export function applyFeatureRelationDraft(relations:FeatureRelation[],changes:FeatureRelationChange[],projectId:string):FeatureRelation[] {
  const byId=new Map(relations.map(r=>[r.id,{...r}]));
  for(const change of changes){
    if(change.op==='delete')byId.delete(change.id);
    else if(change.op==='create')byId.set(change.id,{id:change.id,projectId,sourceFeatureId:change.sourceFeatureId,targetFeatureId:change.targetFeatureId,note:change.note,version:0});
    else {const relation=byId.get(change.id);if(relation)relation.note=change.note;}
  }
  return [...byId.values()];
}
export type FeatureRequirement = { executionStage?:import('./execution-stage').ExecutionStage; id: string; title: string; status: string; version: number; featureId: string | null; deletedAt: string | null; actualEnd: string | null };
export type FeatureRequirements = { items: FeatureRequirement[]; total: number; page: number; pageSize: number; pages: number };
