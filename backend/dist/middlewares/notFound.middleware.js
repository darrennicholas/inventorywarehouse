import { AppError } from "../utils/AppError.js";
export const notFoundHandler = (req, _res, next) => {
    next(new AppError(404, `Route ${req.method} ${req.originalUrl} not found`));
};
