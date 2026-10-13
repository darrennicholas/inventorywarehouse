import { AppError } from "../utils/AppError.js";
export function validateBody(schema) {
    return (req, _res, next) => {
        const result = schema.safeParse(req.body);
        if (!result.success) {
            const errors = result.error.issues.map((issue) => ({
                field: issue.path.join("."),
                message: issue.message,
            }));
            next(new AppError(422, "Validation failed", errors));
            return;
        }
        req.body = result.data;
        next();
    };
}
