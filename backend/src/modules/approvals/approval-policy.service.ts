import { Prisma, type ApprovalSubject } from "../../generated/prisma/client.ts";
import type { AuthContext } from "../../middlewares/auth.middleware.ts";
import { AppError } from "../../utils/AppError.ts";

export type ApprovalTx = Prisma.TransactionClient;

export async function assertApprovalAuthority(
  tx: ApprovalTx,
  subject: ApprovalSubject,
  amount: number,
  auth: Pick<AuthContext, "userId" | "roleCode">,
  creatorId?: string | null,
) {
  const normalizedAmount = Math.max(0, Number.isFinite(amount) ? amount : 0);
  const policy = await tx.approvalPolicy.findFirst({
    where: {
      subject,
      isActive: true,
      minimumAmount: { lte: normalizedAmount },
      OR: [{ maximumAmount: null }, { maximumAmount: { gte: normalizedAmount } }],
    },
    include: { approverRole: { select: { code: true, name: true } } },
    orderBy: { minimumAmount: "desc" },
  });

  // Existing installations remain safe if the additive seed has not been run
  // yet: only an Administrator may approve until a policy is configured.
  if (!policy) {
    if (auth.roleCode !== "ADMIN") {
      throw new AppError(403, `No approval policy is configured for ${subject.toLowerCase()}`);
    }
    if (creatorId && creatorId === auth.userId) {
      throw new AppError(403, "The document creator cannot approve their own document");
    }
    return null;
  }

  if (policy.requiresDifferentCreator && creatorId && creatorId === auth.userId) {
    throw new AppError(403, "The document creator cannot approve their own document");
  }
  if (auth.roleCode !== "ADMIN" && auth.roleCode !== policy.approverRole.code) {
    throw new AppError(403, `Approval for this value requires the ${policy.approverRole.name} role`);
  }
  return policy;
}

