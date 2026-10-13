import "dotenv/config";
import { z } from "zod";
const envSchema = z.object({
    NODE_ENV: z
        .enum(["development", "production", "test"])
        .default("development"),
    PORT: z.coerce
        .number()
        .int()
        .min(1)
        .max(65535)
        .default(5000),
    DATABASE_URL: z.string().min(1),
    FRONTEND_URL: z
        .url()
        .default("http://localhost:3000"),
});
const result = envSchema.safeParse(process.env);
if (!result.success) {
    console.error("Invalid environment configuration:", result.error.issues.map((issue) => ({
        field: issue.path.join("."),
        message: issue.message,
    })));
    throw new Error("Invalid environment configuration");
}
export const env = result.data;
