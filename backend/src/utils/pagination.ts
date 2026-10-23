export function pagination(query: Record<string, unknown>) {
  const pageValue = Number(query.page ?? 1);
  const pageSizeValue = Number(query.pageSize ?? 50);
  const page = Number.isInteger(pageValue) && pageValue > 0 ? pageValue : 1;
  const pageSize = Number.isInteger(pageSizeValue) && pageSizeValue > 0 ? Math.min(pageSizeValue, 100) : 50;
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
}

export function pageMeta(page: number, pageSize: number, total: number) {
  return { page, pageSize, total, totalPages: Math.ceil(total / pageSize) };
}

export function paginateArray<T>(rows: T[], query: Record<string, unknown>) {
  const { page, pageSize, skip, take } = pagination(query);
  return { data: rows.slice(skip, skip + take), meta: pageMeta(page, pageSize, rows.length) };
}

