
import type { RequestHandler } from "express";
import { AppError } from "../utils/AppError.ts";

export const notFoundHandler: RequestHandler = (
  req,
  _res,
  next
) => {
  next(
    new AppError(
      404,
      `Route ${req.method} ${req.originalUrl} not found`
    )
  );
};
