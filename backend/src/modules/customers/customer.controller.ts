import { asyncHandler } from "../../utils/asyncHandler.ts";
import { AppError } from "../../utils/AppError.ts";
import { customerService } from "./customer.service.ts";
import { z } from "zod";
import { notifyByPermission } from "../notifications/notification.service.ts";
import { masterListOptions, pageMeta, paginateArray } from "../../utils/pagination.ts";
import { prisma } from "../../lib/prisma.ts";
import { authOf } from "../../middlewares/auth.middleware.ts";
import { requestAuditContext, writeAuditLog } from "../audit/audit.service.ts";

import type { CreateCustomerInput, ImportCustomersInput, UpdateCustomerInput } from "./customer.validation.ts";

function customerId(value: unknown) {
  const parsed = z.uuid().safeParse(value);
  if (!parsed.success) throw new AppError(400, "Invalid customer ID");
  return parsed.data;
}

export const listCustomers = asyncHandler(async (req, res) => {
  const options = masterListOptions(req.query as Record<string, unknown>);
  if (options) {
    const where = { ...(options.isActive !== undefined ? { isActive: options.isActive } : {}), ...(options.search ? { OR: [{ name: { contains: options.search, mode: "insensitive" as const } }, { code: { contains: options.search, mode: "insensitive" as const } }, { email: { contains: options.search, mode: "insensitive" as const } }, { phone: { contains: options.search, mode: "insensitive" as const } }, { address: { contains: options.search, mode: "insensitive" as const } }] } : {}) };
    const [data, total] = await Promise.all([prisma.customer.findMany({ where, skip: options.skip, take: options.take, orderBy: [{ createdAt: "desc" }, { id: "asc" }] }), prisma.customer.count({ where })]);
    res.status(200).json({ success: true, data, meta: pageMeta(options.page, options.pageSize, total) }); return;
  }
  const customers = await customerService.list();
  const result = paginateArray(customers, req.query as Record<string, unknown>);

  res.status(200).json({
    success: true,
    message: "Customers retrieved successfully",
    ...result,
  });
});

export const createCustomer = asyncHandler(async (req, res) => {
  const input = req.body as CreateCustomerInput;
  const auditContext = requestAuditContext(req, res.locals.requestId as string | undefined);
  const customer = await prisma.$transaction(async (tx) => {
    const created = await tx.customer.create({ data: input });
    await writeAuditLog({ userId: authOf(req).userId, action: "CREATE", entity: "Customer", entityId: created.id, afterData: created, ...auditContext }, tx as never);
    return created;
  });
  await notifyByPermission({ permission: "customers.read", type: "CUSTOMER_CREATED", title: "Customer created", message: `${customer.name} was added to customer master data.`, entity: "Customer", entityId: customer.id });

  res.status(201).json({
    success: true,
    message: "Customer created successfully",
    data: customer,
  });
});

export const getCustomer = asyncHandler(async (req, res) => {
  const customer = await customerService.getById(customerId(req.params.id));
  res.json({ success: true, data: customer });
});

export const updateCustomer = asyncHandler(async (req, res) => {
  const id = customerId(req.params.id);
  const input = req.body as UpdateCustomerInput;
  const auditContext = requestAuditContext(req, res.locals.requestId as string | undefined);
  const customer = await prisma.$transaction(async (tx) => {
    const before = await tx.customer.findUnique({ where: { id } });
    if (!before) throw new AppError(404, "Customer not found");
    const updated = await tx.customer.update({ where: { id }, data: input });
    await writeAuditLog({ userId: authOf(req).userId, action: "UPDATE", entity: "Customer", entityId: id, beforeData: before, afterData: updated, ...auditContext }, tx as never);
    return updated;
  });
  await notifyByPermission({ permission: "customers.read", type: "CUSTOMER_UPDATED", title: "Customer updated", message: `${customer.name} was updated.`, entity: "Customer", entityId: customer.id });
  res.json({ success: true, message: "Customer updated successfully", data: customer });
});

export const deleteCustomer = asyncHandler(async (req, res) => {
  const id = customerId(req.params.id);
  const auditContext = requestAuditContext(req, res.locals.requestId as string | undefined);
  const customer = await prisma.$transaction(async (tx) => {
    const before = await tx.customer.findUnique({ where: { id } });
    if (!before) throw new AppError(404, "Customer not found");
    const updated = await tx.customer.update({ where: { id }, data: { isActive: false } });
    await writeAuditLog({ userId: authOf(req).userId, action: "DEACTIVATE", entity: "Customer", entityId: id, beforeData: before, afterData: updated, ...auditContext }, tx as never);
    return updated;
  });
  await notifyByPermission({ permission: "customers.read", type: "CUSTOMER_DEACTIVATED", title: "Customer deactivated", message: `${customer.name} was deactivated.`, entity: "Customer", entityId: customer.id });
  res.json({ success: true, message: "Customer deactivated successfully", data: customer });
});

export const importCustomers = asyncHandler(async (req, res) => {
  const input = req.body as ImportCustomersInput;
  const uniqueByCode = [...new Map(input.rows.map((row) => [row.code, row])).values()];
  const auditContext = requestAuditContext(req, res.locals.requestId as string | undefined);
  const result = await prisma.$transaction(async (tx) => {
    const created = await tx.customer.createMany({ data: uniqueByCode, skipDuplicates: true });
    const summary = { imported: created.count, skipped: input.rows.length - created.count };
    await writeAuditLog({ userId: authOf(req).userId, action: "IMPORT", entity: "Customer", afterData: { ...summary, codes: uniqueByCode.map((row) => row.code) }, ...auditContext }, tx as never);
    return summary;
  });
  res.status(201).json({ success: true, message: `${result.imported} customers imported`, data: result });
});
