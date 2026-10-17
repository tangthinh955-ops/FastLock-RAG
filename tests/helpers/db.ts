import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client";

const connectionString = process.env.TEST_DATABASE_URL;

if (!connectionString) {
  throw new Error(
    "TEST_DATABASE_URL is not set — integration tests need it (see .env.example)",
  );
}

if (connectionString === process.env.DATABASE_URL) {
  throw new Error(
    "TEST_DATABASE_URL must not point at the dev database (DATABASE_URL)",
  );
}

/** Prisma client pointed at the test database only — never the dev DB. */
export const testPrisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

// Child tables first, parents last (CASCADE makes order belt-and-braces).
const TRUNCATE_TABLES = [
  '"DirectMessage"',
  '"Order"',
  '"Conversation"',
  '"LiveSession"',
  '"KbEntry"',
  '"Product"',
  '"Shop"',
  '"User"',
].join(",");

/** Wipe every table and restart ids/sequences. Call from `beforeEach`. */
export async function resetDb(): Promise<void> {
  await testPrisma.$executeRawUnsafe(
    `TRUNCATE ${TRUNCATE_TABLES} RESTART IDENTITY CASCADE`,
  );
}
