
import type {
  ErrorRequestHandler,
  Request,
} from "express";

import { AppError } from "../utils/AppError.ts";
import { reportError } from "../lib/monitoring.ts";
import { ZodError } from "zod";

function isPrismaUniqueError(
  error: unknown
): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2002"
  );
}

export const errorHandler: ErrorRequestHandler = (
  error: unknown,
  req,
  res,
  _next
) => {
  const requestId = res.locals.requestId as string | undefined;
  const userId = (req as Request & { auth?: { userId: string } }).auth?.userId;
  // Use the registered route template; raw paths can contain record IDs.
  const route = `${req.baseUrl}${req.route?.path ?? "unmatched"}`;
  reportError(error, { requestId, method: req.method, route, userId });
  const responseMeta = requestId ? { requestId } : {};

  // Custom Application Error
  if (error instanceof AppError) {
    res.status(error.statusCode).json({
      success: false,
      message: error.message,
      ...responseMeta,
      ...(error.details !== undefined
        ? { errors: error.details }
        : {}),
    });

    return;
  }

  if (error instanceof ZodError) {
    res.status(400).json({
      success: false,
      message: error.issues[0]?.message ?? "Invalid request data",
      errors: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
      ...responseMeta,
    });
    return;
  }

  // Prisma Unique Constraint Error
  if (isPrismaUniqueError(error)) {
    res.status(409).json({
      success: false,
      message: "Data already exists",
      ...responseMeta,
    });

    return;
  }

  // Invalid JSON Request Body
  if (
    error instanceof SyntaxError &&
    "body" in error
  ) {
    res.status(400).json({
      success: false,
      message: "Invalid JSON request body",
      ...responseMeta,
    });

    return;
  }

  // Unexpected Server Error
  const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
  if (["P2034", "P2003", "P2004"].includes(code)) {
    res.status(409).json({ success: false, message: code === "P2034" ? "Data changed during this transaction. Reload and try again; no partial changes were saved." : "This action conflicts with linked data or a database constraint.", ...responseMeta }); return;
  }
  if (code === "P2025") { res.status(404).json({ success: false, message: "Record no longer exists. Reload the page.", ...responseMeta }); return; }
  if (code === "P2010" && typeof error === "object" && error !== null && "meta" in error) {
    const meta = error.meta as { code?: string } | undefined;
    if (meta?.code && ["23514", "40001", "40P01"].includes(meta.code)) { res.status(409).json({ success: false, message: "Stock or related data changed. Reload and retry; the transaction was rolled back.", ...responseMeta }); return; }
  }
  res.status(500).json({
    success: false,
    message: "Internal server error",
    ...responseMeta,
  });
};
