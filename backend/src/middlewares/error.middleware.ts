
import type {
  ErrorRequestHandler,
} from "express";

import { AppError } from "../utils/AppError.ts";
import { reportError } from "../lib/monitoring.ts";

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
  reportError(error, { requestId, method: req.method, path: req.originalUrl });
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
  res.status(500).json({
    success: false,
    message: "Internal server error",
    ...responseMeta,
  });
};
