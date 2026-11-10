import { statusLabel } from "@/lib/ui-labels";

type Tone = "neutral" | "info" | "success" | "warning" | "danger";

function toneFor(status: string): Tone {
  const value = status.toUpperCase();
  if (["ACTIVE", "COMPLETED", "POSTED", "RECEIVED", "APPROVED", "PAID", "AVAILABLE", "NORMAL", "SETTLED", "FULFILLED", "RESTOCKED"].includes(value)) return "success";
  if (["PENDING", "SUBMITTED", "COUNTING", "PICKING", "PACKED", "IN_TRANSIT", "PARTIALLY_RECEIVED", "PARTIALLY_SHIPPED", "PARTIALLY_PAID", "REVISION", "UNPAID", "PENDING_PAYMENT", "FOLLOW_UP", "ON_HOLD"].includes(value)) return "warning";
  if (["REJECTED", "CANCELLED", "VOID", "EXPIRED", "DEPLETED", "SHORTAGE", "OVERDUE", "DAMAGED", "INACTIVE", "FAILED", "BLOCKED", "DEFECTIVE"].includes(value)) return "danger";
  if (["RESERVED", "SHIPPED", "QUARANTINED", "OVERSTOCK", "DRAFT", "GOOD", "RESTOCK", "SCRAP"].includes(value)) return "info";
  return "neutral";
}

export default function StatusBadge({ status, label }: { status: string; label?: string }) {
  return <span className={`sf-status-badge sf-status-${toneFor(status)}`}>{label ?? statusLabel(status)}</span>;
}
