
import { z } from "zod";
import { AppError } from "./AppError.ts";

export function requireUuid(
  value: unknown,
  label = "ID"
): string {
  if (
    typeof value !== "string" ||
    !z.uuid().safeParse(value).success
  ) {
    throw new AppError(400, `Invalid ${label}`);
  }

  return value;
}
