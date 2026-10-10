

export type AuditLog = { id: string; actorType: string; actorId: string | null; actorName: string | null; tokenName: string | null; action: string; entityType: string; entityId: string | null; projectId: string | null; projectName?: string | null; summary: string; createdAt: string;
  objectDeleted?: boolean; workItemDeleted?: boolean; workItemRequirementId?: string | null };

export type AuditPage = { items: AuditLog[]; total: number; page: number; pageSize: number; pages: number; snapshot: number };
