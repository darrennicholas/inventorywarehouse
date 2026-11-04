import { createHash, randomUUID } from "node:crypto";

export function notificationEventKey(event: { eventKey?: string; type: string; entity?: string; entityId?: string; message: string }, now = Date.now()) {
  return event.eventKey ?? (event.entity && event.entityId
    ? createHash("sha256").update(JSON.stringify([event.type, event.entity, event.entityId, event.message, Math.floor(now / 300_000)])).digest("hex")
    : randomUUID());
}
