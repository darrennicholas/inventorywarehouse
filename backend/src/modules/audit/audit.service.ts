import { prisma } from "../../lib/prisma.ts";

export type AuditInput = {
  userId?: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  beforeData?: unknown;
  afterData?: unknown;
  requestId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
};

function toJson(value: unknown): unknown {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value, (_key, item) =>
    typeof item === "bigint" ? item.toString() : item,
  ));
}

export async function writeAuditLog(
  input: AuditInput,
  client: typeof prisma = prisma,
) {
  return client.auditLog.create({
    data: {
      userId: input.userId ?? null,
      action: input.action,
      entity: input.entity,
      entityId: input.entityId ?? null,
      beforeData: toJson(input.beforeData) as never,
      afterData: toJson(input.afterData) as never,
      requestId: input.requestId ?? null,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
    },
  });
}

export function requestAuditContext(req: { headers: Record<string, string | string[] | undefined>; ip?: string }) {
  const rawAgent = req.headers["user-agent"];
  return {
    requestId: typeof req.headers["x-request-id"] === "string" ? req.headers["x-request-id"] : null,
    ipAddress: req.ip ?? null,
    userAgent: Array.isArray(rawAgent) ? rawAgent[0] ?? null : rawAgent ?? null,
  };
}
