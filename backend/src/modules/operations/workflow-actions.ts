export type WorkflowAction = "approve" | "reject" | "releaseReservation";
export type WorkflowKind = "purchases" | "sales" | "adjustments" | "transfers" | "returns" | "opnames";

const reviewStatuses: Partial<Record<WorkflowKind, readonly string[]>> = {
  purchases: ["PENDING"],
  adjustments: ["DRAFT"],
  transfers: ["DRAFT"],
  returns: ["PENDING"],
  opnames: ["SUBMITTED"],
};

export function workflowActions(input: {
  kind: WorkflowKind;
  status: string;
  permission: string;
  permissions: readonly string[];
  isCreator: boolean;
  approvalAllowed: boolean;
  rejectionAllowed?: boolean;
  hasActiveReservation?: boolean;
  hasActiveShipment?: boolean;
}): WorkflowAction[] {
  const actions: WorkflowAction[] = [];
  const awaitingReview = reviewStatuses[input.kind]?.includes(input.status) ?? false;
  const canReview = awaitingReview
    && input.permissions.includes(`${input.permission}.approve`)
    && !input.isCreator;

  if (canReview && input.approvalAllowed) actions.push("approve");
  if (canReview && (input.rejectionAllowed ?? input.approvalAllowed)) actions.push("reject");

  if (
    input.kind === "sales"
    && input.status === "RESERVED"
    && input.permissions.includes("sales.write")
    && input.hasActiveReservation
    && !input.hasActiveShipment
  ) actions.push("releaseReservation");

  return actions;
}
