import { z } from "zod";
import { AppError } from "./AppError.js";
export function requireUuid(value, label = "ID") {
    if (typeof value !== "string" ||
        !z.uuid().safeParse(value).success) {
        throw new AppError(400, `Invalid ${label}`);
    }
    return value;
}
