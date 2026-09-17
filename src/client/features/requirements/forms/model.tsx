

import { readReferenceLinks, type ReferenceLink } from "../../../../shared/reference-links";

import type { Requirement } from "../../../types";

export type RequirementInfoDraft = {
  featureId:string;
  phaseId:string;
  reason?:string;
  title: string; ownerId: string; background: string; acceptanceCriteria: string; referenceUrl: string; referenceLinks?:ReferenceLink[];
};

export const requirementInfoFields: Array<keyof RequirementInfoDraft> = ["featureId", "phaseId", "title", "ownerId", "background", "acceptanceCriteria", "referenceUrl", "referenceLinks"];

export function requirementInfoDraft(requirement: Requirement): RequirementInfoDraft {
  return {
    featureId:requirement.featureId||'',phaseId:requirement.phaseId||'',
    title: requirement.title, ownerId: requirement.ownerId || "",
    background: requirement.background || "", acceptanceCriteria: requirement.acceptanceCriteria || "",
    referenceUrl: requirement.referenceUrl || "", referenceLinks:readReferenceLinks(requirement.referenceLinks,requirement.referenceUrl),
  };
}
