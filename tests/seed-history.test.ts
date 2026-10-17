import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  LiveStatus,
  MessageSource,
  OrderStatus,
} from "../generated/prisma/client";
import { seedBase } from "../prisma/seed/base";
import { seedHistory } from "../prisma/seed/history";
import { SEED_IDS } from "../prisma/seed/ids";
import { resetDb, testPrisma } from "./helpers/db";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Số ngày lịch (theo giờ máy) từ hôm nay lùi ngược về mốc thời gian cho trước. */
function daysAgo(date: Date): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const day = new Date(date);
  day.setHours(0, 0, 0, 0);
  return Math.round((today.getTime() - day.getTime()) / DAY_MS);
}

/** Khung "trong đêm" 22h–6h (giờ máy) — cơ sở cho badge hội thoại ban đêm. */
function isNight(date: Date): boolean {
  const hour = date.getHours();
  return hour >= 22 || hour < 6;
}

/** "HH:mm" theo giờ máy — để assert mốc 20:00 / 22:05 mà không so instant. */
function hhmm(date: Date): string {
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

/** Assert date non-null trước khi dùng (endedAt/paidAt là nullable trong schema). */
function must(date: Date | null): Date {
  if (date === null) {
    throw new Error("seed phải set giá trị ngày này");
  }
  return date;
}

async function snapshotCounts() {
  const [conversations, messages, sessions, orders] = await Promise.all([
    testPrisma.conversation.count(),
    testPrisma.directMessage.count(),
    testPrisma.liveSession.count(),
    testPrisma.order.count(),
  ]);
  return { conversations, messages, sessions, orders };
}

describe("seedHistory — lịch sử demo (hội thoại đêm, live cũ, đơn cũ)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  describe("sau seedBase + seedHistory", () => {
    beforeEach(async () => {
      await seedBase(testPrisma);
      await seedHistory(testPrisma);
    });

    it("tạo đúng 5 hội thoại giữa 3 khách và 2 shop, id cố định trong SEED_IDS.history", async () => {
      const conversations = await testPrisma.conversation.findMany();

      // Đúng 5 cặp khách↔shop chốt trong plan: 3 hội thoại của shop Linh
      // (Khách/Hồng/Minh) + 2 hội thoại của shop Bảo An (Khách/Hồng).
      expect(conversations.map((c) => [c.buyerId, c.shopId]).sort()).toEqual(
        [
          [SEED_IDS.users.khach, SEED_IDS.shops.linh],
          [SEED_IDS.users.hong, SEED_IDS.shops.linh],
          [SEED_IDS.users.minh, SEED_IDS.shops.linh],
          [SEED_IDS.users.khach, SEED_IDS.shops.baoan],
          [SEED_IDS.users.hong, SEED_IDS.shops.baoan],
        ].sort(),
      );

      expect(conversations.map((c) => c.id).sort()).toEqual(
        Object.values(SEED_IDS.history.conversations).sort(),
      );
    });

    it("20 tin nhắn rải 7–30 ngày trước, mỗi hội thoại khách hỏi trước và được trả lời", async () => {
      const messages = await testPrisma.directMessage.findMany();

      // 5 hội thoại × 4 tin — đủ dày cho Dashboard/badge mà vẫn gọn.
      expect(messages).toHaveLength(20);
      expect(messages.map((m) => m.id).sort()).toEqual(
        Object.values(SEED_IDS.history.messages).sort(),
      );

      for (const message of messages) {
        const age = daysAgo(message.createdAt);
        expect(age).toBeGreaterThanOrEqual(7);
        expect(age).toBeLessThanOrEqual(30);
      }

      // Mỗi hội thoại mở bằng tin BUYER và kết thúc bằng trả lời AI/seller.
      for (const conversationId of Object.values(
        SEED_IDS.history.conversations,
      )) {
        const inConversation = await testPrisma.directMessage.findMany({
          where: { conversationId },
          orderBy: { createdAt: "asc" },
        });

        expect(inConversation.length).toBeGreaterThanOrEqual(3);
        expect(inConversation[0]?.source).toBe(MessageSource.BUYER);
        expect(inConversation.at(-1)?.source).not.toBe(MessageSource.BUYER);
      }
    });

    it("≥2 hội thoại có tin AI trả lời trong khung 22h–6h (badge 'hội thoại trong đêm')", async () => {
      const messages = await testPrisma.directMessage.findMany();

      const nightAiConversations = new Set(
        messages
          .filter((m) => m.source === MessageSource.AI && isNight(m.createdAt))
          .map((m) => m.conversationId),
      );

      expect(nightAiConversations.size).toBeGreaterThanOrEqual(2);

      // Khách hỏi lúc 23:10, AI trả lời sau nửa đêm (00:12) — đúng "nhóm đêm"
      // của plan; shop chính (Linh) cũng phải có hội thoại đêm để demo badge.
      const khachLinh = messages.filter(
        (m) => m.conversationId === SEED_IDS.history.conversations.khach_linh,
      );
      expect(khachLinh.map((m) => hhmm(m.createdAt))).toContain("23:10");
      expect(
        khachLinh.some(
          (m) => m.source === MessageSource.AI && hhmm(m.createdAt) === "00:12",
        ),
      ).toBe(true);
      expect(nightAiConversations).toContain(
        SEED_IDS.history.conversations.khach_linh,
      );
    });

    it("2 phiên live ENDED của shop Linh — 1 tối hôm qua (20:00–22:05), 1 cách đây 7 ngày", async () => {
      const sessions = await testPrisma.liveSession.findMany({
        where: { shopId: SEED_IDS.shops.linh },
        orderBy: { startedAt: "asc" },
      });

      expect(sessions).toHaveLength(2);
      expect(sessions.every((s) => s.status === LiveStatus.ENDED)).toBe(true);
      expect(
        sessions.map((s) => s.id).sort(),
      ).toEqual(Object.values(SEED_IDS.history.sessions).sort());
      // Demo hôm nay chỉ có phiên cũ trong seed — phiên LIVE do Studio tạo sau.
      expect(
        await testPrisma.liveSession.count({
          where: { status: LiveStatus.LIVE },
        }),
      ).toBe(0);

      const [weekAgo, yesterday] = sessions;

      expect(yesterday.id).toBe(SEED_IDS.history.sessions.linh_yesterday);
      expect(daysAgo(yesterday.startedAt)).toBe(1);
      expect(hhmm(yesterday.startedAt)).toBe("20:00");
      expect(hhmm(must(yesterday.endedAt))).toBe("22:05");

      expect(weekAgo.id).toBe(SEED_IDS.history.sessions.linh_week_ago);
      expect(daysAgo(weekAgo.startedAt)).toBe(7);
      expect(daysAgo(must(weekAgo.endedAt))).toBe(7);
    });

    it("5 đơn lịch sử đúng bảng plan — SP × qty, tổng, trạng thái, phiên live", async () => {
      const orders = await testPrisma.order.findMany({
        include: { product: true },
        orderBy: { createdAt: "asc" },
      });

      expect(orders).toHaveLength(5);

      // Bảng cố định: SP01×2=300k PAID · SP02×2=440k PAID · SP03×1=120k
      // CANCELLED · SP04×1=260k SHIPPED · SP06×3=960k PAID (giá spec §9).
      expect(
        orders.map((o) => ({
          sku: o.product.sku,
          qty: o.qty,
          unitPrice: o.unitPrice,
          total: o.total,
          status: o.status,
        })),
      ).toEqual([
        { sku: "SP04", qty: 1, unitPrice: 260_000, total: 260_000, status: OrderStatus.SHIPPED },
        { sku: "SP06", qty: 3, unitPrice: 320_000, total: 960_000, status: OrderStatus.PAID },
        { sku: "SP01", qty: 2, unitPrice: 150_000, total: 300_000, status: OrderStatus.PAID },
        { sku: "SP02", qty: 2, unitPrice: 220_000, total: 440_000, status: OrderStatus.PAID },
        { sku: "SP03", qty: 1, unitPrice: 120_000, total: 120_000, status: OrderStatus.CANCELLED },
      ]);

      // Toàn bộ thuộc shop Linh, buyer rải giữa 3 khách seed.
      expect(orders.every((o) => o.shopId === SEED_IDS.shops.linh)).toBe(true);
      expect(new Set(orders.map((o) => o.buyerId))).toEqual(
        new Set([SEED_IDS.users.khach, SEED_IDS.users.hong, SEED_IDS.users.minh]),
      );

      // eventId/paymentCode cố định dạng seed-h1/SEEDH1 (unique).
      expect(orders.map((o) => o.eventId)).toEqual([
        "seed-h4",
        "seed-h5",
        "seed-h1",
        "seed-h2",
        "seed-h3",
      ]);
      expect(orders.map((o) => o.paymentCode)).toEqual([
        "SEEDH4",
        "SEEDH5",
        "SEEDH1",
        "SEEDH2",
        "SEEDH3",
      ]);

      // Mỗi đơn gắn đúng phiên live và tạo (thu tiền) trong khung giờ phiên.
      const sessions = await testPrisma.liveSession.findMany({
        where: { shopId: SEED_IDS.shops.linh },
      });
      const sessionById = new Map(sessions.map((s) => [s.id, s]));

      for (const order of orders) {
        const session = sessionById.get(order.liveSessionId ?? "");
        expect(session).toBeDefined();
        if (!session) {
          throw new Error(`đơn ${order.eventId} thiếu phiên live`);
        }

        expect(order.createdAt.getTime()).toBeGreaterThanOrEqual(
          session.startedAt.getTime(),
        );
        expect(order.createdAt.getTime()).toBeLessThanOrEqual(
          must(session.endedAt).getTime(),
        );

        if (order.paidAt !== null) {
          expect(order.paidAt.getTime()).toBeGreaterThanOrEqual(
            session.startedAt.getTime(),
          );
          expect(order.paidAt.getTime()).toBeLessThanOrEqual(
            must(session.endedAt).getTime(),
          );
        }
      }
    });

    it("tổng đã thu tiền (paidAt != null) của shop Linh = 1.960.000đ; đủ PAID/SHIPPED/CANCELLED", async () => {
      const paid = await testPrisma.order.aggregate({
        where: { shopId: SEED_IDS.shops.linh, paidAt: { not: null } },
        _sum: { total: true },
      });
      // 300.000 + 440.000 + 260.000 + 960.000 (bảng plan Task 4).
      expect(paid._sum.total).toBe(1_960_000);

      for (const status of [
        OrderStatus.PAID,
        OrderStatus.SHIPPED,
        OrderStatus.CANCELLED,
      ]) {
        expect(
          await testPrisma.order.count({
            where: { shopId: SEED_IDS.shops.linh, status },
          }),
        ).toBeGreaterThanOrEqual(1);
      }

      // Đơn CANCELLED chưa thu tiền; 4 đơn còn lại đã thu tiền.
      const cancelled = await testPrisma.order.findMany({
        where: { status: OrderStatus.CANCELLED },
      });
      expect(cancelled).toHaveLength(1);
      expect(cancelled[0]?.paidAt).toBeNull();

      const collected = await testPrisma.order.findMany({
        where: { status: { not: OrderStatus.CANCELLED } },
      });
      expect(collected).toHaveLength(4);
      expect(collected.every((o) => o.paidAt !== null)).toBe(true);
    });

    it("đơn lịch sử không trừ kho — kho đúng spec §9 ngay khi demo bắt đầu", async () => {
      const products = await testPrisma.product.findMany({
        where: { shopId: SEED_IDS.shops.linh },
        orderBy: { sku: "asc" },
      });

      expect(products.map((p) => [p.sku, p.stock])).toEqual([
        ["SP01", 8],
        ["SP02", 5],
        ["SP03", 10],
        ["SP04", 4],
        ["SP05", 6],
        ["SP06", 3],
        ["SP07", 12],
      ]);
    });
  });

  it("chạy seed lần 2 (upsert) không nhân đôi hội thoại/tin nhắn/phiên/đơn", async () => {
    await seedBase(testPrisma);
    await seedHistory(testPrisma);

    const afterFirst = await snapshotCounts();
    expect(afterFirst).toEqual({
      conversations: 5,
      messages: 20,
      sessions: 2,
      orders: 5,
    });

    await seedBase(testPrisma);
    await seedHistory(testPrisma);
    expect(await snapshotCounts()).toEqual(afterFirst);
  });
});
