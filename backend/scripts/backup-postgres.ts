import "dotenv/config";

import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL belum diatur di backend/.env");
const dumpDatabaseUrl = new URL(databaseUrl);
// `schema=public` is a Prisma-only query parameter and pg_dump rejects it.
dumpDatabaseUrl.searchParams.delete("schema");

const outputDirectory = resolve(process.argv[2] ?? join(import.meta.dirname, "..", "backups"));
await mkdir(outputDirectory, { recursive: true });
const timestamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
const outputFile = join(outputDirectory, `inventorywarehouse-${timestamp}.dump`);

try {
  await execFileAsync("pg_dump", ["--dbname", dumpDatabaseUrl.toString(), "--format=custom", "--no-owner", "--no-privileges", "--file", outputFile], { windowsHide: true });
  console.log(`Backup berhasil: ${outputFile}`);
} catch (error) {
  const code = typeof error === "object" && error !== null && "code" in error
    ? String(error.code)
    : "unknown";
  throw new Error(`pg_dump gagal (code ${code}). Pastikan PostgreSQL bin tersedia di PATH dan database dapat diakses.`);
}
