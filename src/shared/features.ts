import { z } from 'zod';
export const featureRelationInput = z.object({
  id: z.string().min(1).optional(), expectedVersion: z.number().int().positive().optional(),
  sourceFeatureId: z.string().min(1), targetFeatureId: z.string().min(1), note: z.string().trim().max(2000).default(''),
}).strict();
export type FeatureRelation = { id: string; projectId: string; sourceFeatureId: string; targetFeatureId: string; note: string; version: number };
export type FeatureRequirement = { id: string; title: string; status: string; version: number; groupId: string | null; deletedAt: string | null; actualEnd: string | null };
export type FeatureRequirements = { items: FeatureRequirement[]; total: number; page: number; pageSize: number; pages: number };
