
import type { ReturnStatus } from "@/types/returns";
import StatusBadge from "@/components/ui/StatusBadge";

export default function ReturnStatusBadge({
  status,
}: {
  status: ReturnStatus;
}) {
  return <StatusBadge status={status} />;
}
