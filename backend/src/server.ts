
import app from "./app.ts";
import { Pool, type PoolClient } from "pg";

import { prisma } from "./lib/prisma.ts";
import { env } from "./config/env.ts";
import { releaseExpiredReservations, updateExpiredBatches } from "./modules/operations/inventory.service.ts";
import { captureDailyInventoryValuationSnapshot } from "./modules/operations/valuation-snapshot.service.ts";
import { reportError } from "./lib/monitoring.ts";
import { setReadiness } from "./modules/health/health.controller.ts";

const maintenanceLockId = "770612345001";
const maintenancePool = new Pool({ connectionString: env.DATABASE_URL, max: 1, connectionTimeoutMillis: 5_000 });

async function startServer() {
  try {
    // Connect PostgreSQL
    await prisma.$connect();

    console.log(
      "PostgreSQL connected successfully"
    );

    // Start Express
    const server = app.listen(env.PORT, () => {
      console.log(
        `Backend running at http://localhost:${env.PORT}`
      );
    });

    const runMaintenance = async () => {
      let client: PoolClient | undefined;
      let hasLock = false;
      try {
        client = await maintenancePool.connect();
        const result = await client.query<{ locked: boolean }>("SELECT pg_try_advisory_lock($1::bigint) AS locked", [maintenanceLockId]);
        hasLock = result.rows[0]?.locked === true;
        if (!hasLock) return;
        const jobs: Array<[string, () => Promise<unknown>]> = [
          ["expire-batches", updateExpiredBatches],
          ["release-expired-reservations", releaseExpiredReservations],
          ["capture-daily-valuation", captureDailyInventoryValuationSnapshot],
        ];
        for (const [job, run] of jobs) {
          try {
            await run();
          } catch (error) {
            reportError(error, { job, route: "background-maintenance" });
          }
        }
      } catch (error) {
        reportError(error, { job: "maintenance-lock", route: "background-maintenance" });
      } finally {
        if (client) {
          if (hasLock) {
            try { await client.query("SELECT pg_advisory_unlock($1::bigint)", [maintenanceLockId]); }
            catch (error) { reportError(error, { job: "maintenance-unlock", route: "background-maintenance" }); }
          }
          client.release();
        }
      }
    };
    let activeMaintenance: Promise<void> | null = null;
    const triggerMaintenance = () => {
      if (activeMaintenance) return;
      activeMaintenance = runMaintenance().finally(() => { activeMaintenance = null; });
    };
    const maintenanceTimer = setInterval(triggerMaintenance, 60_000);
    maintenanceTimer.unref();
    triggerMaintenance();

    let shuttingDown = false;

    // Graceful shutdown
    async function shutdown(signal: string) {
      if (shuttingDown) return;

      shuttingDown = true;
      setReadiness(false);
      console.log(`Received ${signal}. Shutting down...`);
      clearInterval(maintenanceTimer);
      if (activeMaintenance) await activeMaintenance;

      server.close(async () => {
        try {
          await prisma.$disconnect();
          await maintenancePool.end();

          console.log(
            "PostgreSQL disconnected successfully"
          );

          process.exit(0);
        } catch (error) {
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
  } catch (error) {
    console.error(
      "Failed to start server:",
      error
    );

    await prisma.$disconnect();
    process.exit(1);
  }
}

void startServer();
