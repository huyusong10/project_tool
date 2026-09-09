export type BlockerCoordination = {
  coordinatorId:string|null; coordinatorName:string; nextReviewAt:string|null;
  issueId:string|null; issueTitle:string|null; issueResolved:boolean;
};
export const coordinationKeys=['blockedCoordinatorId','blockedNextReviewAt','blockedIssueId'] as const;
