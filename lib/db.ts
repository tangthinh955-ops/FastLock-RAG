import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";

type PrismaClientInstance = InstanceType<typeof PrismaClient>;

declare global {
  var __prisma: PrismaClientInstance | undefined;
}

function createPrismaClient(): PrismaClientInstance {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set — copy .env.example to .env");
  }

  // Prisma 7: Postgres connections go through a driver adapter.
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}

// Hot-reload-safe singleton (dev) / one client per server process (prod).
export const prisma = globalThis.__prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalThis.__prisma = prisma;
}
