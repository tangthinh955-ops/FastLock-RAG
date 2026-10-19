import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { countAiConversationsAtNight } from "../lib/chat/stats";
import { resetDb, testPrisma } from "./helpers/db";

/**
 * Integration thật trên PostgreSQL test cho `countAiConversationsAtNight`
 * (Task 10 — dây C, spec §8.4): đếm **số hội thoại khác nhau** có ≥1 tin AI với
 * giờ Việt Nam trong khung [22:00, 06:00).
 *
 * Mọi mốc thời gian được dựng từ giờ VN (UTC+7, không DST) rồi quy về UTC —
 * bài học từ badge: KHÔNG bao giờ dựa vào timezone của máy chạy test.
 */

/**
 * Mốc UTC ứng với `hour:minute` giờ Việt Nam ngày `day/monthIndex`.
 * VN = UTC+7 nên trừ 7 giờ; giờ âm tự lùi ngày (03:00 VN 10/4 → 20:00 UTC 9/4).
 */
function atVietnam(
  year: number,
  monthIndex: number,
  day: number,
  hour: number,
  minute = 0,
): Date {
  return new Date(Date.UTC(year, monthIndex, day, hour - 7, minute));
}

/**
 * 2 shop (mỗi shop một chủ) + 4 buyer riêng — mỗi hội thoại cần một buyer KHÁC
 * nhau vì unique `[buyerId, shopId]` (một khách một hội thoại trên mỗi shop).
 */
async function seedFixture(): Promise<{
  buyers: string[];
  shopA: string;
  shopB: string;
}> {
  const ownerA = await testPrisma.user.create({
    data: { email: "stats-owner-a@test.vn", passwordHash: "x", name: "Chủ A", role: "SELLER" },
  });
  const ownerB = await testPrisma.user.create({
    data: { email: "stats-owner-b@test.vn", passwordHash: "x", name: "Chủ B", role: "SELLER" },
  });
  const buyers = await Promise.all(
    [1, 2, 3, 4].map((index) =>
      testPrisma.user.create({
        data: {
          email: `stats-buyer-${index}@test.vn`,
          passwordHash: "x",
          name: `Khách ${index}`,
          role: "BUYER",
        },
      }),
    ),
  );

  const shopA = await testPrisma.shop.create({
    data: { name: "Shop A", ownerId: ownerA.id },
  });
  const shopB = await testPrisma.shop.create({
    data: { name: "Shop B", ownerId: ownerB.id },
  });

  return { buyers: buyers.map((buyer) => buyer.id), shopA: shopA.id, shopB: shopB.id };
}

/** Hội thoại mới của shop kèm các tin (source, createdAt) — mỗi phần tử 1 tin. */
async function seedConversation(
  shopId: string,
  buyerId: string,
  messages: Array<{ source: "AI" | "BUYER" | "SELLER" | "SYSTEM"; createdAt: Date }>,
): Promise<string> {
  const conversation = await testPrisma.conversation.create({
    data: { buyerId, shopId },
  });
  for (const message of messages) {
    await testPrisma.directMessage.create({
      data: {
        conversationId: conversation.id,
        source: message.source,
        content: `tin ${message.source}`,
        createdAt: message.createdAt,
      },
    });
  }
  return conversation.id;
}

describe("countAiConversationsAtNight — đếm hội thoại AI trực đêm (22h–6h VN)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  it("3 hội thoại cùng shop: 23:00 VN + 03:00 VN được đếm, 12:00 VN không → 2", async () => {
    const { buyers, shopA } = await seedFixture();

    await seedConversation(shopA, buyers[0], [
      { source: "AI", createdAt: atVietnam(2026, 3, 10, 23, 0) },
    ]);
    await seedConversation(shopA, buyers[1], [
      { source: "AI", createdAt: atVietnam(2026, 3, 10, 3, 0) },
    ]);
    await seedConversation(shopA, buyers[2], [
      { source: "AI", createdAt: atVietnam(2026, 3, 10, 12, 0) },
    ]);

    await expect(countAiConversationsAtNight(testPrisma, shopA)).resolves.toBe(2);
  });

  it("biên khung đêm: 22:00 VN tính, 06:00 VN và 21:59 VN không tính → 1", async () => {
    const { buyers, shopA } = await seedFixture();

    await seedConversation(shopA, buyers[0], [
      { source: "AI", createdAt: atVietnam(2026, 3, 10, 22, 0) },
    ]);
    await seedConversation(shopA, buyers[1], [
      { source: "AI", createdAt: atVietnam(2026, 3, 11, 6, 0) },
    ]);
    await seedConversation(shopA, buyers[2], [
      { source: "AI", createdAt: atVietnam(2026, 3, 10, 21, 59) },
    ]);

    await expect(countAiConversationsAtNight(testPrisma, shopA)).resolves.toBe(1);
  });

  it("nhiều tin đêm trong cùng một hội thoại chỉ đếm một lần; tin không phải AI bị bỏ qua", async () => {
    const { buyers, shopA } = await seedFixture();

    // Một hội thoại có 2 tin AI trong đêm (23:00 + 03:00) → vẫn là 1.
    await seedConversation(shopA, buyers[0], [
      { source: "BUYER", createdAt: atVietnam(2026, 3, 10, 22, 30) },
      { source: "AI", createdAt: atVietnam(2026, 3, 10, 23, 0) },
      { source: "AI", createdAt: atVietnam(2026, 3, 11, 3, 0) },
    ]);
    // Hội thoại chỉ có tin BUYER/SELLER lúc đêm → không tính.
    await seedConversation(shopA, buyers[1], [
      { source: "BUYER", createdAt: atVietnam(2026, 3, 10, 23, 30) },
      { source: "SELLER", createdAt: atVietnam(2026, 3, 10, 23, 45) },
    ]);

    await expect(countAiConversationsAtNight(testPrisma, shopA)).resolves.toBe(1);
  });

  it("không lộ hội thoại shop khác: đêm của shop B không cộng vào shop A → 0", async () => {
    const { buyers, shopA, shopB } = await seedFixture();

    await seedConversation(shopB, buyers[0], [
      { source: "AI", createdAt: atVietnam(2026, 3, 10, 23, 0) },
    ]);
    await seedConversation(shopB, buyers[1], [
      { source: "AI", createdAt: atVietnam(2026, 3, 11, 3, 0) },
    ]);

    await expect(countAiConversationsAtNight(testPrisma, shopA)).resolves.toBe(0);
    await expect(countAiConversationsAtNight(testPrisma, shopB)).resolves.toBe(2);
  });
});
