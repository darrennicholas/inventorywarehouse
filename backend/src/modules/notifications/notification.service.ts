import { randomUUID } from "node:crypto";

import { prisma } from "../../lib/prisma.ts";

type NotificationEvent = {
  permission: string;
  type: string;
  title: string;
  message: string;
  entity?: string;
  entityId?: string;
  warehouseId?: string;
  eventKey?: string;
};

/**
 * Creates durable in-app notifications for every active user who can see the
 * related module. Warehouse staff only receive events from their own site;
 * supervisory roles continue to receive cross-warehouse events.
 */
export async function notifyByPermission(event: NotificationEvent, client: any = prisma) {
  try {
    const users = await client.user.findMany({
    where: {
      isActive: true,
      role: {
        isActive: true,
        permissions: { some: { permission: { key: event.permission } } },
      },
      ...(event.warehouseId
        ? {
            OR: [
              { role: { code: { not: "WAREHOUSE_STAFF" } } },
              { staff: { warehouseId: event.warehouseId } },
            ],
          }
        : {}),
    },
    select: { id: true },
    });

    if (users.length === 0) return;
    const eventKey = event.eventKey ?? randomUUID();
    await client.notification.createMany({
      data: users.map((user: { id: string }) => ({
        fingerprint: `${eventKey}:${user.id}`,
        userId: user.id,
        type: event.type,
        title: event.title,
        message: event.message,
        entity: event.entity ?? null,
        entityId: event.entityId ?? null,
      })),
      skipDuplicates: true,
    });
  } catch {
    // Notifications are auxiliary. A transient notification failure must not
    // roll back a successful inventory operation or make the request fail.
  }
}

