export const actionReasonCodes = [
  'planning', 'missing_owner', 'missing_work_items', 'incomplete_schedule', 'high_risk',
  'delayed', 'pending_acceptance', 'blocked', 'unassigned', 'overdue', 'path_blocked',
] as const;

export const actionReasonLabels = {
  path_blocked: '交付路径受阻',
  planning: '待规划',
  missing_owner: '缺少需求负责人',
  missing_work_items: '缺少工作项',
  incomplete_schedule: '排期不完整',
  high_risk: '高风险',
  delayed: '需求延期',
  pending_acceptance: '待验收',
  blocked: '工作项阻塞',
  unassigned: '未分派',
  overdue: '问题逾期',
} as const;

export type ActionReasonCode = typeof actionReasonCodes[number];
export type ActionSeverity = 'high' | 'medium' | 'low';
export type ActionSourceType = 'requirement' | 'work_item' | 'issue';

export type ActionReason = {
  code: ActionReasonCode;
  label: string;
};

export type ActionItem = {
  id: string;
  sourceType: ActionSourceType;
  sourceId: string;
  projectId: string;
  requirementId: string | null;
  contextTitle: string | null;
  title: string;
  severity: ActionSeverity;
  reasons: ActionReason[];
  reasonCodes: ActionReasonCode[];
  ownerId: string | null;
  ownerName: string | null;
  dueDate: string | null;
  overdueWorkdays: number;
  targetPath: string;
  updatedAt: string;
};

export type ActionItemsPage = {
  asOfDate: string;
  items: ActionItem[];
  total: number;
  page: number;
  pageSize: number;
  pages: number;
  /** 当前账号可见行动范围内实际出现的负责人，用于避免暴露无关项目成员。 */
  ownerOptions: Array<{ id: string; name: string; count: number }>;
  hasUnassigned: boolean;
  summary: {
    total: number;
    high: number;
    medium: number;
    low: number;
    byReason: Partial<Record<ActionReasonCode, number>>;
  };
};
