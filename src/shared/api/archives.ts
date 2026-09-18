

export type Archives = {
  projects: ArchiveItem[]; requirements: ArchiveItem[]; people: ArchiveItem[]; templates: ArchiveItem[];
};

export type ArchiveItem = {
  id: string; title: string; jobTitle?: string | null; projectName?: string | null; deletedAt: string;
  requirementCount?: number; workItemCount?: number; issueCount?: number; templateCount?: number;
  progressCount?: number; linkedIssueCount?: number;
};
