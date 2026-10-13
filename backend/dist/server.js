import app from "./app.js";
import { prisma } from "./lib/prisma.js";
import { env } from "./config/env.js";
async function startServer() {
    try {
        // Connect PostgreSQL
        await prisma.$connect();
        console.log("PostgreSQL connected successfully");
        // Start Express
        const server = app.listen(env.PORT, () => {
            console.log(`Backend running at http://localhost:${env.PORT}`);
        });
        let shuttingDown = false;
        // Graceful shutdown
        async function shutdown(signal) {
            if (shuttingDown)
                return;
            shuttingDown = true;
            console.log(`Received ${signal}. Shutting down...`);
            server.close(async () => {
                try {
                    await prisma.$disconnect();
                    console.log("PostgreSQL disconnected successfully");
                    process.exit(0);
                }
                catch (error) {
                    console.error("Shutdown error:", error);
                    process.exit(1);
                }
            });
        }
        process.on("SIGINT", () => {
            void shutdown("SIGINT");
        });
        process.on("SIGTERM", () => {
            void shutdown("SIGTERM");
        });
    }
    catch (error) {
        console.error("Failed to start server:", error);
        await prisma.$disconnect();
        process.exit(1);
    }
}
void startServer();
