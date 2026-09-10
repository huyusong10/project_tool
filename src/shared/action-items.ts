export const actionReasonLabels = {
 follow_up:'到期跟进',missing_owner:'缺少需求负责人',missing_work_items:'缺少工作项',incomplete_schedule:'排期不完整',high_risk:'进度落后',delayed:'需求延期',unassigned:'未分派',overdue:'问题逾期',path_blocked:'前置或日期待补齐',owner_unavailable:'负责人不可用',
} as const;
export const actionReasonCodes = Object.keys(actionReasonLabels) as Array<keyof typeof actionReasonLabels>;

export type ActionReasonCode = typeof actionReasonCodes[number];
export type ActionSeverity = 'high' | 'medium' | 'low';
export type ActionSourceType = 'requirement' | 'work_item' | 'issue' | 'milestone';

export type ActionReason = {
  code: ActionReasonCode;
  label: string;
};

export type ActionItem = Partial<import('./delivery').ProcessingResult> & {
  nextReviewAt?:string|null;coordinationIssueId?:string|null;
  affectedRequirements?:Array<{id:string;title:string}>;minFloat?:number|null;riskLevel?:string;riskEvaluated?:boolean;
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
