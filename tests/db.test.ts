import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { Role } from "../generated/prisma/client";
import { resetDb, testPrisma } from "./helpers/db";

describe("test database infrastructure", () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  it("persists a user and reads it back", async () => {
    const created = await testPrisma.user.create({
      data: {
        email: "buyer@example.com",
        passwordHash: "hashed",
        name: "Người mua",
        role: Role.BUYER,
      },
    });

    const found = await testPrisma.user.findUnique({
      where: { id: created.id },
    });

    expect(found).not.toBeNull();
    expect(found?.email).toBe("buyer@example.com");
    expect(found?.role).toBe(Role.BUYER);
    expect(await testPrisma.user.count()).toBe(1);
  });

  it("starts each test with an empty database", async () => {
    expect(await testPrisma.user.count()).toBe(0);
  });
});
