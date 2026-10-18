import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../lib/auth/service";
import {
  appendMessage,
  getMessages,
  getOrCreateConversation,
  handBackToAi,
  listBuyerConversations,
  listShopConversations,
  sellerSendMessage,
  type ConversationListItem,
} from "../lib/chat/service";
import { resetDb, testPrisma } from "./helpers/db";

/**
 * Integration thật trên PostgreSQL test cho service hội thoại Inbox (Task 6):
 * service là hàm thuần nhận `prisma` (cùng đường code với socket gateway Task 7),
 * không đụng socket/AI. Mọi mốc `createdAt`/`updatedAt` của fixture được GHIM
 * tường minh để thứ tự danh sách không phụ thuộc tốc độ máy.
 */

const BASE_MS = Date.UTC(2026, 0, 1, 8, 0, 0);

/** Mốc thời gian thứ `seconds` sau BASE — ghim thẳng vào DB, không dựa đồng hồ. */
function at(seconds: number): Date {
  return new Date(BASE_MS + seconds * 1000);
}

type Fixture = {
  buyerA: { id: string; name: string };
  buyerB: { id: string; name: string };
  shopA: { id: string; name: string };
  shopB: { id: string; name: string };
  shopC: { id: string; name: string };
};

/** 2 buyer + 3 shop (mỗi shop một chủ riêng) — đủ cho mọi ca lọc/đua. */
async function seedFixture(): Promise<Fixture> {
  const ownerA = await testPrisma.user.create({
    data: { email: "owner-a@test.vn", passwordHash: "x", name: "Chủ A", role: "SELLER" },
  });
  const ownerB = await testPrisma.user.create({
    data: { email: "owner-b@test.vn", passwordHash: "x", name: "Chủ B", role: "SELLER" },
  });
  const ownerC = await testPrisma.user.create({
    data: { email: "owner-c@test.vn", passwordHash: "x", name: "Chủ C", role: "SELLER" },
  });
  const buyerA = await testPrisma.user.create({
    data: { email: "buyer-a@test.vn", passwordHash: "x", name: "Khách A", role: "BUYER" },
  });
  const buyerB = await testPrisma.user.create({
    data: { email: "buyer-b@test.vn", passwordHash: "x", name: "Khách B", role: "BUYER" },
  });

  const shopA = await testPrisma.shop.create({
    data: { name: "Shop Thời Trang A", ownerId: ownerA.id },
  });
  const shopB = await testPrisma.shop.create({
    data: { name: "Shop Sơ Mi B", ownerId: ownerB.id },
  });
  const shopC = await testPrisma.shop.create({
    data: { name: "Shop Phụ Kiện C", ownerId: ownerC.id },
  });

  return {
    buyerA: { id: buyerA.id, name: buyerA.name },
    buyerB: { id: buyerB.id, name: buyerB.name },
    shopA: { id: shopA.id, name: shopA.name },
    shopB: { id: shopB.id, name: shopB.name },
    shopC: { id: shopC.id, name: shopC.name },
  };
}

/** Assert promise ném ra ApiError đúng status — tránh lặp try/catch trong test. */
async function expectApiError(
  attempt: Promise<unknown>,
  status: number,
): Promise<void> {
  const error = await attempt.then(
    () => null,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(ApiError);
  expect((error as ApiError).status).toBe(status);
}

/** Tin trong DB của một hội thoại, cũ nhất trước — để đối chiếu nội dung. */
function messagesOf(conversationId: string) {
  return testPrisma.directMessage.findMany({
    where: { conversationId },
    orderBy: { createdAt: "asc" },
  });
}

function idsOf(items: ConversationListItem[]): string[] {
  return items.map((item) => item.conversation.id);
}

describe("chat service — hội thoại, takeover version, dedup", () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  describe("getOrCreateConversation", () => {
    it("gọi hai lần liên tiếp → cùng id, DB chỉ một dòng (unique buyer+shop)", async () => {
      const { buyerA, shopA } = await seedFixture();

      const first = await getOrCreateConversation(testPrisma, buyerA.id, shopA.id);
      const second = await getOrCreateConversation(testPrisma, buyerA.id, shopA.id);

      expect(second.id).toBe(first.id);
      expect(first.mode).toBe("AI");
      expect(first.version).toBe(1);
      const count = await testPrisma.conversation.count({
        where: { buyerId: buyerA.id, shopId: shopA.id },
      });
      expect(count).toBe(1);
    });

    it("gọi song song (đua unique) → mọi lời gọi cùng một hội thoại, không nhân dòng", async () => {
      const { buyerA, shopB } = await seedFixture();

      const results = await Promise.all(
        Array.from({ length: 5 }, () =>
          getOrCreateConversation(testPrisma, buyerA.id, shopB.id),
        ),
      );

      expect(new Set(results.map((conversation) => conversation.id)).size).toBe(1);
      const count = await testPrisma.conversation.count({
        where: { buyerId: buyerA.id, shopId: shopB.id },
      });
      expect(count).toBe(1);
    });

    it("trúng nhánh đua P2002: pre-check trượt vẫn trả dòng thắng, không ném", async () => {
      const { buyerA, shopA } = await seedFixture();
      const existing = await testPrisma.conversation.create({
        data: { buyerId: buyerA.id, shopId: shopA.id },
      });

      // Ép pre-check trượt như hai request cùng thấy "chưa có": lần findUnique
      // đầu trả null (giả), lần trong catch P2002 đọc dòng thật của người thắng.
      const findUnique = vi
        .spyOn(testPrisma.conversation, "findUnique")
        .mockResolvedValueOnce(null);
      try {
        const result = await getOrCreateConversation(
          testPrisma,
          buyerA.id,
          shopA.id,
        );
        expect(result.id).toBe(existing.id);
        // Đúng 2 lần: pre-check (giả) + đọc lại trong catch → nhánh P2002 chạy thật.
        expect(findUnique).toHaveBeenCalledTimes(2);
      } finally {
        findUnique.mockRestore();
      }
    });
  });

  describe("appendMessage", () => {
    it("lưu đủ trường (source, dedupKey, orderId, trace)", async () => {
      const { buyerA, shopA } = await seedFixture();
      const conversation = await getOrCreateConversation(
        testPrisma,
        buyerA.id,
        shopA.id,
      );
      const trace = { model: "fake", fallback: "FULL_KB" };

      const created = await appendMessage(testPrisma, {
        conversationId: conversation.id,
        source: "BUYER",
        content: "Shop ơi, áo này còn size M không?",
        dedupKey: "msg:abc:1",
        orderId: "order-khong-ton-tai-cung-duoc-vi-khong-co-FK",
        trace,
      });

      expect(created).not.toBeNull();
      expect(created?.source).toBe("BUYER");
      expect(created?.content).toBe("Shop ơi, áo này còn size M không?");
      expect(created?.dedupKey).toBe("msg:abc:1");

      const [stored] = await messagesOf(conversation.id);
      expect(stored.id).toBe(created?.id);
      expect(stored.orderId).toBe("order-khong-ton-tai-cung-duoc-vi-khong-co-FK");
      expect(stored.trace).toEqual(trace);
    });

    it("dedupKey trùng → lần hai trả null, DB vẫn chỉ một tin", async () => {
      const { buyerA, shopA } = await seedFixture();
      const conversation = await getOrCreateConversation(
        testPrisma,
        buyerA.id,
        shopA.id,
      );

      const first = await appendMessage(testPrisma, {
        conversationId: conversation.id,
        source: "BUYER",
        content: "Tin gửi lần đầu",
        dedupKey: "msg:nonce-1",
      });
      const replay = await appendMessage(testPrisma, {
        conversationId: conversation.id,
        source: "BUYER",
        content: "Tin gửi lại cùng nonce",
        dedupKey: "msg:nonce-1",
      });

      expect(first).not.toBeNull();
      expect(replay).toBeNull();
      const stored = await messagesOf(conversation.id);
      expect(stored).toHaveLength(1);
      expect(stored[0].content).toBe("Tin gửi lần đầu");
    });

    it("không có dedupKey → mọi tin đều được lưu (không dedup nhầm)", async () => {
      const { buyerA, shopA } = await seedFixture();
      const conversation = await getOrCreateConversation(
        testPrisma,
        buyerA.id,
        shopA.id,
      );

      const first = await appendMessage(testPrisma, {
        conversationId: conversation.id,
        source: "SELLER",
        content: "Dạ còn nhé",
      });
      const second = await appendMessage(testPrisma, {
        conversationId: conversation.id,
        source: "SELLER",
        content: "Dạ còn nhé",
      });

      expect(first).not.toBeNull();
      expect(second).not.toBeNull();
      expect(await testPrisma.directMessage.count()).toBe(2);
    });

    it("lỗi KHÁC P2002 (hội thoại không tồn tại) → ném tiếp, không nuốt thành null", async () => {
      await seedFixture();

      await expect(
        appendMessage(testPrisma, {
          conversationId: "khong-ton-tai",
          source: "BUYER",
          content: "x",
        }),
      ).rejects.toThrow();
    });
  });

  describe("sellerSendMessage", () => {
    it("takeover: tin SELLER + mode HUMAN + version +1", async () => {
      const { buyerA, shopA } = await seedFixture();
      const conversation = await getOrCreateConversation(
        testPrisma,
        buyerA.id,
        shopA.id,
      );

      const { message, conversation: after } = await sellerSendMessage(
        testPrisma,
        {
          conversationId: conversation.id,
          sellerShopId: shopA.id,
          content: "Shop trả lời tay nhé!",
        },
      );

      expect(message.source).toBe("SELLER");
      expect(message.content).toBe("Shop trả lời tay nhé!");
      expect(message.conversationId).toBe(conversation.id);
      expect(after.mode).toBe("HUMAN");
      expect(after.version).toBe(conversation.version + 1);

      const stored = await testPrisma.conversation.findUniqueOrThrow({
        where: { id: conversation.id },
      });
      expect(stored.mode).toBe("HUMAN");
      expect(stored.version).toBe(2);
      const storedMessages = await messagesOf(conversation.id);
      expect(storedMessages).toHaveLength(1);
      expect(storedMessages[0].source).toBe("SELLER");
    });

    it("sai shop → ApiError 403, không đổi state (không tin, không mode/version)", async () => {
      const { buyerA, shopA, shopB } = await seedFixture();
      const conversation = await getOrCreateConversation(
        testPrisma,
        buyerA.id,
        shopA.id,
      );

      await expectApiError(
        sellerSendMessage(testPrisma, {
          conversationId: conversation.id,
          sellerShopId: shopB.id,
          content: "Định trả lời hội thoại shop khác",
        }),
        403,
      );

      const stored = await testPrisma.conversation.findUniqueOrThrow({
        where: { id: conversation.id },
      });
      expect(stored.mode).toBe("AI");
      expect(stored.version).toBe(1);
      expect(await messagesOf(conversation.id)).toHaveLength(0);
    });

    it("hội thoại không tồn tại → ApiError 403 (không lộ tồn tại)", async () => {
      const { shopA } = await seedFixture();

      await expectApiError(
        sellerSendMessage(testPrisma, {
          conversationId: "khong-ton-tai",
          sellerShopId: shopA.id,
          content: "x",
        }),
        403,
      );
    });
  });

  describe("handBackToAi", () => {
    it("trả lại AI: mode AI + version +1", async () => {
      const { buyerA, shopA } = await seedFixture();
      const conversation = await getOrCreateConversation(
        testPrisma,
        buyerA.id,
        shopA.id,
      );
      const { conversation: takenOver } = await sellerSendMessage(testPrisma, {
        conversationId: conversation.id,
        sellerShopId: shopA.id,
        content: "Takeover trước đã",
      });

      const after = await handBackToAi(testPrisma, {
        conversationId: conversation.id,
        sellerShopId: shopA.id,
      });

      expect(after.mode).toBe("AI");
      expect(after.version).toBe(takenOver.version + 1);

      const stored = await testPrisma.conversation.findUniqueOrThrow({
        where: { id: conversation.id },
      });
      expect(stored.mode).toBe("AI");
      expect(stored.version).toBe(3);
    });

    it("sai shop → ApiError 403, state giữ nguyên HUMAN", async () => {
      const { buyerA, shopA, shopB } = await seedFixture();
      const conversation = await getOrCreateConversation(
        testPrisma,
        buyerA.id,
        shopA.id,
      );
      await sellerSendMessage(testPrisma, {
        conversationId: conversation.id,
        sellerShopId: shopA.id,
        content: "Takeover",
      });

      await expectApiError(
        handBackToAi(testPrisma, {
          conversationId: conversation.id,
          sellerShopId: shopB.id,
        }),
        403,
      );

      const stored = await testPrisma.conversation.findUniqueOrThrow({
        where: { id: conversation.id },
      });
      expect(stored.mode).toBe("HUMAN");
      expect(stored.version).toBe(2);
    });
  });

  describe("listBuyerConversations", () => {
    it("chỉ hội thoại của buyer, sắp theo hoạt động mới nhất, lastMessage khớp thứ tự", async () => {
      const { buyerA, buyerB, shopA, shopB, shopC } = await seedFixture();

      // A1: updatedAt(10) nhưng tin cuối CŨ (3) → hoạt động thật = 10.
      const convA1 = await testPrisma.conversation.create({
        data: { buyerId: buyerA.id, shopId: shopA.id, updatedAt: at(10) },
      });
      await testPrisma.directMessage.create({
        data: {
          conversationId: convA1.id,
          source: "BUYER",
          content: "Tin cũ của A1",
          createdAt: at(3),
        },
      });
      // A2: updatedAt(0) nhưng tin cuối MỚI (20) → phải đứng đầu.
      const convA2 = await testPrisma.conversation.create({
        data: { buyerId: buyerA.id, shopId: shopB.id, updatedAt: at(0) },
      });
      const newest = await testPrisma.directMessage.create({
        data: {
          conversationId: convA2.id,
          source: "AI",
          content: "Tin mới nhất của A2",
          createdAt: at(20),
        },
      });
      // A3: chưa có tin nào, updatedAt(15) → giữa A2 và A1, lastMessage null.
      const convA3 = await testPrisma.conversation.create({
        data: { buyerId: buyerA.id, shopId: shopC.id, updatedAt: at(15) },
      });
      // B: hoạt động mới nhất (30) nhưng của buyer khác — không được lọt vào.
      const convB = await testPrisma.conversation.create({
        data: { buyerId: buyerB.id, shopId: shopA.id, updatedAt: at(5) },
      });
      await testPrisma.directMessage.create({
        data: {
          conversationId: convB.id,
          source: "BUYER",
          content: "Tin của B",
          createdAt: at(30),
        },
      });

      const items = await listBuyerConversations(testPrisma, buyerA.id);

      expect(idsOf(items)).toEqual([convA2.id, convA3.id, convA1.id]);
      expect(items[0].shop).toEqual({ id: shopB.id, name: shopB.name });
      expect(items[0].lastMessage?.id).toBe(newest.id);
      expect(items[1].shop).toEqual({ id: shopC.id, name: shopC.name });
      expect(items[1].lastMessage).toBeNull();
      expect(items[2].shop).toEqual({ id: shopA.id, name: shopA.name });
      expect(items[2].lastMessage?.content).toBe("Tin cũ của A1");
    });
  });

  describe("listShopConversations", () => {
    it("của đúng shop, kèm tên buyer, sắp theo hoạt động mới nhất", async () => {
      const { buyerA, buyerB, shopA, shopB } = await seedFixture();

      // S1: buyerA — có tin nhưng cũ (hoạt động = 2).
      const convS1 = await testPrisma.conversation.create({
        data: { buyerId: buyerA.id, shopId: shopA.id, updatedAt: at(2) },
      });
      await testPrisma.directMessage.create({
        data: {
          conversationId: convS1.id,
          source: "BUYER",
          content: "Khách A hỏi",
          createdAt: at(2),
        },
      });
      // S2: buyerB — chưa có tin, updatedAt(9) → đứng trước S1.
      const convS2 = await testPrisma.conversation.create({
        data: { buyerId: buyerB.id, shopId: shopA.id, updatedAt: at(9) },
      });
      // Shop khác: hoạt động mới nhất nhưng không thuộc shopA — không được lọt vào.
      const convOther = await testPrisma.conversation.create({
        data: { buyerId: buyerB.id, shopId: shopB.id, updatedAt: at(30) },
      });

      const items = await listShopConversations(testPrisma, shopA.id);

      expect(idsOf(items)).toEqual([convS2.id, convS1.id]);
      expect(items[0].buyer).toEqual({ id: buyerB.id, name: buyerB.name });
      expect(items[0].lastMessage).toBeNull();
      expect(items[1].buyer).toEqual({ id: buyerA.id, name: buyerA.name });
      expect(items[1].lastMessage?.content).toBe("Khách A hỏi");
      expect(idsOf(items)).not.toContain(convOther.id);
    });
  });

  describe("getMessages", () => {
    it("mặc định trả toàn bộ theo thứ tự thời gian tăng dần, đúng hội thoại", async () => {
      const { buyerA, shopA, shopB } = await seedFixture();
      const conversation = await getOrCreateConversation(
        testPrisma,
        buyerA.id,
        shopA.id,
      );
      for (let i = 1; i <= 5; i += 1) {
        await testPrisma.directMessage.create({
          data: {
            conversationId: conversation.id,
            source: "BUYER",
            content: `Tin ${i}`,
            createdAt: at(i),
          },
        });
      }
      const other = await getOrCreateConversation(testPrisma, buyerA.id, shopB.id);
      await testPrisma.directMessage.create({
        data: {
          conversationId: other.id,
          source: "BUYER",
          content: "Tin hội thoại khác",
          createdAt: at(1),
        },
      });

      const messages = await getMessages(testPrisma, conversation.id);

      expect(messages.map((message) => message.content)).toEqual([
        "Tin 1",
        "Tin 2",
        "Tin 3",
        "Tin 4",
        "Tin 5",
      ]);
    });

    it("take N → N tin MỚI NHẤT, vẫn theo thứ tự tăng dần", async () => {
      const { buyerA, shopA } = await seedFixture();
      const conversation = await getOrCreateConversation(
        testPrisma,
        buyerA.id,
        shopA.id,
      );
      for (let i = 1; i <= 6; i += 1) {
        await testPrisma.directMessage.create({
          data: {
            conversationId: conversation.id,
            source: i % 2 === 0 ? "AI" : "BUYER",
            content: `Tin ${i}`,
            createdAt: at(i),
          },
        });
      }

      const newestThree = await getMessages(testPrisma, conversation.id, { take: 3 });

      expect(newestThree.map((message) => message.content)).toEqual([
        "Tin 4",
        "Tin 5",
        "Tin 6",
      ]);
    });
  });
});
