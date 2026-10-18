import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { MessageSource, Role } from "../generated/prisma/client";
import { resetDb, testPrisma } from "./helpers/db";

/**
 * DirectMessage.trace (Json?) — chỗ lưu evidence RAG của tin AI (model,
 * entries đã truy hồi, tokens…). Test chứng minh JSON ghi/đọc lại nguyên vẹn.
 */
describe("DirectMessage.trace", () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  it("lưu và đọc lại JSON trace", async () => {
    const buyer = await testPrisma.user.create({
      data: {
        email: "buyer-trace@example.com",
        passwordHash: "hashed",
        name: "Người mua",
        role: Role.BUYER,
      },
    });
    const seller = await testPrisma.user.create({
      data: {
        email: "seller-trace@example.com",
        passwordHash: "hashed",
        name: "Người bán",
        role: Role.SELLER,
      },
    });
    const shop = await testPrisma.shop.create({
      data: { name: "Shop trace", ownerId: seller.id },
    });
    const conversation = await testPrisma.conversation.create({
      data: { buyerId: buyer.id, shopId: shop.id },
    });

    const trace = { model: "qwen/qwen3-32b", fallback: null };

    const created = await testPrisma.directMessage.create({
      data: {
        conversationId: conversation.id,
        source: MessageSource.AI,
        content: "Dạ em kiểm tra đơn giúp mình ạ!",
        trace,
      },
    });

    const found = await testPrisma.directMessage.findUniqueOrThrow({
      where: { id: created.id },
    });

    expect(found.trace).toEqual(trace);
  });
});
