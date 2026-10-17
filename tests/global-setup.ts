import "dotenv/config";
import { execSync } from "node:child_process";

/** Applies prisma migrations to TEST_DATABASE_URL before any test runs. */
export default function globalSetup(): void {
  const testDatabaseUrl = process.env.TEST_DATABASE_URL;

  if (!testDatabaseUrl) {
    throw new Error(
      "TEST_DATABASE_URL is not set — integration tests need it (see .env.example)",
    );
  }

  if (testDatabaseUrl === process.env.DATABASE_URL) {
    throw new Error(
      "TEST_DATABASE_URL must not point at the dev database (DATABASE_URL)",
    );
  }

  // execSync always runs through a shell; on Windows use npx.cmd explicitly.
  const npx = process.platform === "win32" ? "npx.cmd" : "npx";

  execSync(`${npx} prisma migrate deploy`, {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: testDatabaseUrl },
  });
}
