import { z } from "zod";

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
  search: z.string().trim().max(120).default(""),
}).strict();

export function pagination(query: Record<string, unknown>) {
  const pageValue = Number(query.page ?? 1);
  const pageSizeValue = Number(query.pageSize ?? 50);
  const page = Number.isInteger(pageValue) && pageValue > 0 ? pageValue : 1;
  const pageSize = Number.isInteger(pageSizeValue) && pageSizeValue > 0 ? Math.min(pageSizeValue, 100) : 50;
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
}

export function masterListOptions(query: Record<string, unknown>) {
  const hasServerPaging = query.page !== undefined || query.pageSize !== undefined || query.search !== undefined || query.isActive !== undefined;
  if (!hasServerPaging) return null;
  const pageInfo = pagination(query);
  const search = typeof query.search === "string" ? query.search.trim().slice(0, 100) : "";
  const activeValue = query.isActive;
  const isActive = activeValue === "true" ? true : activeValue === "false" ? false : undefined;
  return { ...pageInfo, search, isActive };
}

export function pageMeta(page: number, pageSize: number, total: number) {
  return { page, pageSize, total, totalPages: Math.ceil(total / pageSize) };
}

export function paginateArray<T>(rows: T[], query: Record<string, unknown>) {
  // Master-data screens currently paginate locally. If the client does not ask
  // for a page explicitly, return the full collection instead of silently
  // truncating it to the API's transaction default (50 rows).
  if (query.page === undefined && query.pageSize === undefined) {
    return {
      data: rows,
      meta: pageMeta(1, Math.max(rows.length, 1), rows.length),
    };
  }
  const { page, pageSize, skip, take } = pagination(query);
  return { data: rows.slice(skip, skip + take), meta: pageMeta(page, pageSize, rows.length) };
}

