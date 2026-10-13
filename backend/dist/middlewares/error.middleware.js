import { AppError } from "../utils/AppError.js";
function isPrismaUniqueError(error) {
    return (typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "P2002");
}
export const errorHandler = (error, _req, res, _next) => {
    // Custom Application Error
    if (error instanceof AppError) {
        res.status(error.statusCode).json({
            success: false,
            message: error.message,
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
        });
        return;
    }
    // Invalid JSON Request Body
    if (error instanceof SyntaxError &&
        "body" in error) {
        res.status(400).json({
            success: false,
            message: "Invalid JSON request body",
        });
        return;
    }
    // Unexpected Server Error
    console.error("Unhandled API error:", error);
    res.status(500).json({
        success: false,
        message: "Internal server error",
    });
};
