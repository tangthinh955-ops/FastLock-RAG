import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { Prisma } from "../generated/prisma/client";
import type { AiTrace } from "../lib/chat/trace";
import {
  getDashboardStats,
  rangeBounds,
  type DashboardRange,
} from "../lib/dashboard/service";
import { resetDb, testPrisma } from "./helpers/db";

/**
 * Integration thật trên PostgreSQL test cho Dashboard (Plan 3 Task 5).
 *
 * Mọi mốc thời gian trong file là UTC viết cứng; ý nghĩa giờ Việt Nam (UTC+7,
 * không DST) ghi trong comment để test không phụ thuộc timezone máy chạy và
 * không phụ thuộc "hôm nay" của hệ thống:
 * - `now` = 2026-10-21T10:00:00Z = 17:00 VN ngày 21/10.
 * - todayStart = 2026-10-20T17:00:00Z = 00:00 VN ngày 21/10.
 * - 7dStart = 2026-10-14T17:00:00Z (6 ngày trước todayStart).
 * - 30dStart = 2026-09-21T17:00:00Z (29 ngày trước todayStart).
 */

const NOW = new Date("2026-10-21T10:00:00Z");

type Fixture = {
  shopA: string;
  shopB: string;
  products: Record<"A" | "B" | "C" | "D", { id: string; sku: string; name: string }>;
};

/** Trace hợp lệ tối thiểu — `readTrace` chỉ cần đúng shape + `elapsedMs`. */
function makeTrace(elapsedMs: number): AiTrace {
  return {
    model: "qwen/qwen3.8-27b",
    topK: [
      {
        id: "trace-kb-size",
        title: "Bảng size — chọn size theo chiều cao & cân nặng",
        kind: "kb",
        score: 0.91,
      },
    ],
    products: [
      { sku: "SP01", name: "Áo thun basic", price: 150_000, stock: 8 },
    ],
    tokens: { prompt: 320, completion: 96 },
    elapsedMs,
  };
}

let orderSeq = 0;

async function createOrder(
  shopId: string,
  buyerId: string,
  productId: string,
  options: {
    qty: number;
    unitPrice: number;
    status: "PENDING" | "PAID" | "SHIPPED" | "CANCELLED";
    createdAt: Date;
    paidAt: Date | null;
  },
): Promise<void> {
  orderSeq += 1;
  await testPrisma.order.create({
    data: {
      shopId,
      buyerId,
      productId,
      qty: options.qty,
      unitPrice: options.unitPrice,
      total: options.qty * options.unitPrice,
      status: options.status,
      eventId: `dashboard-event-${orderSeq}`,
      paymentCode: `DASH${orderSeq}`,
      createdAt: options.createdAt,
      paidAt: options.paidAt,
    },
  });
}

async function seedFixture(): Promise<Fixture> {
  const [ownerA, ownerB, buyer1, buyer2, buyer3] = await Promise.all([
    testPrisma.user.create({
      data: { email: "dash-owner-a@test.vn", passwordHash: "x", name: "Chủ A", role: "SELLER" },
    }),
    testPrisma.user.create({
      data: { email: "dash-owner-b@test.vn", passwordHash: "x", name: "Chủ B", role: "SELLER" },
    }),
    testPrisma.user.create({
      data: { email: "dash-buyer-1@test.vn", passwordHash: "x", name: "Khách 1", role: "BUYER" },
    }),
    testPrisma.user.create({
      data: { email: "dash-buyer-2@test.vn", passwordHash: "x", name: "Khách 2", role: "BUYER" },
    }),
    testPrisma.user.create({
      data: { email: "dash-buyer-3@test.vn", passwordHash: "x", name: "Khách 3", role: "BUYER" },
    }),
  ]);

  const shopA = await testPrisma.shop.create({
    data: { name: "Shop A", ownerId: ownerA.id },
  });
  const shopB = await testPrisma.shop.create({
    data: { name: "Shop B", ownerId: ownerB.id },
  });

  const [productA, productB, productC, productD, productShopB] = await Promise.all([
    testPrisma.product.create({
      data: { shopId: shopA.id, sku: "SP01", name: "Áo thun basic", price: 150_000, stock: 8 },
    }),
    testPrisma.product.create({
      data: { shopId: shopA.id, sku: "SP02", name: "Quần jogger", price: 220_000, stock: 5 },
    }),
    testPrisma.product.create({
      data: { shopId: shopA.id, sku: "SP03", name: "Nón bucket", price: 120_000, stock: 10 },
    }),
    testPrisma.product.create({
      data: { shopId: shopA.id, sku: "SP04", name: "Quần short jean", price: 260_000, stock: 4 },
    }),
    testPrisma.product.create({
      data: { shopId: shopB.id, sku: "SP01", name: "Áo sơ mi công sở", price: 200_000, stock: 5 },
    }),
  ]);

  // --- Đơn của shop A -------------------------------------------------------
  // Hôm nay 09:55 → 10:00 VN: PAID, 2 × 150.000 = 300.000.
  await createOrder(shopA.id, buyer1.id, productA.id, {
    qty: 2,
    unitPrice: 150_000,
    status: "PAID",
    createdAt: new Date("2026-10-21T02:55:00Z"),
    paidAt: new Date("2026-10-21T03:00:00Z"),
  });
  // 3 ngày trước (18/10) 14:55 → 15:00 VN: PAID, 1 × 220.000.
  await createOrder(shopA.id, buyer2.id, productB.id, {
    qty: 1,
    unitPrice: 220_000,
    status: "PAID",
    createdAt: new Date("2026-10-18T07:55:00Z"),
    paidAt: new Date("2026-10-18T08:00:00Z"),
  });
  // 20 ngày trước (1/10) 09:55 → 10:00 VN: PAID, 1 × 120.000 (chỉ 30d thấy).
  await createOrder(shopA.id, buyer1.id, productC.id, {
    qty: 1,
    unitPrice: 120_000,
    status: "PAID",
    createdAt: new Date("2026-10-01T02:55:00Z"),
    paidAt: new Date("2026-10-01T03:00:00Z"),
  });
  // 2 ngày trước (19/10) 19:55 → 20:00 VN: SHIPPED đã thu tiền, 4 × 150.000.
  await createOrder(shopA.id, buyer3.id, productA.id, {
    qty: 4,
    unitPrice: 150_000,
    status: "SHIPPED",
    createdAt: new Date("2026-10-19T12:55:00Z"),
    paidAt: new Date("2026-10-19T13:00:00Z"),
  });
  // Hôm nay: PENDING và CANCELLED — đếm theo createdAt, không vào doanh thu.
  await createOrder(shopA.id, buyer2.id, productD.id, {
    qty: 3,
    unitPrice: 260_000,
    status: "PENDING",
    createdAt: new Date("2026-10-21T04:00:00Z"),
    paidAt: null,
  });
  await createOrder(shopA.id, buyer3.id, productD.id, {
    qty: 2,
    unitPrice: 260_000,
    status: "CANCELLED",
    createdAt: new Date("2026-10-21T04:30:00Z"),
    paidAt: null,
  });

  // --- Đơn shop B hôm nay — không được lọt vào số của shop A ----------------
  await createOrder(shopB.id, buyer1.id, productShopB.id, {
    qty: 3,
    unitPrice: 200_000,
    status: "PAID",
    createdAt: new Date("2026-10-21T05:00:00Z"),
    paidAt: new Date("2026-10-21T05:00:00Z"),
  });

  // --- Phiên live: 12 (hôm nay) / 40 (3 ngày trước) / ngoài khoảng ---------
  await Promise.all([
    testPrisma.liveSession.create({
      data: {
        shopId: shopA.id,
        title: "Live hôm nay",
        status: "ENDED",
        startedAt: new Date("2026-10-21T01:00:00Z"),
        endedAt: new Date("2026-10-21T02:00:00Z"),
        peakViewers: 12,
      },
    }),
    testPrisma.liveSession.create({
      data: {
        shopId: shopA.id,
        title: "Live 3 ngày trước",
        status: "ENDED",
        startedAt: new Date("2026-10-18T12:00:00Z"),
        endedAt: new Date("2026-10-18T13:00:00Z"),
        peakViewers: 40,
      },
    }),
    testPrisma.liveSession.create({
      data: {
        shopId: shopA.id,
        title: "Live ngoài khoảng",
        status: "ENDED",
        startedAt: new Date("2026-09-01T12:00:00Z"),
        endedAt: new Date("2026-09-01T13:00:00Z"),
        peakViewers: 100,
      },
    }),
  ]);

  // --- AI: 2 hội thoại shop A, 1 hội thoại shop B --------------------------
  const conversationA1 = await testPrisma.conversation.create({
    data: { buyerId: buyer1.id, shopId: shopA.id },
  });
  const conversationA2 = await testPrisma.conversation.create({
    data: { buyerId: buyer2.id, shopId: shopA.id },
  });
  const conversationB = await testPrisma.conversation.create({
    data: { buyerId: buyer3.id, shopId: shopB.id },
  });

  await testPrisma.directMessage.createMany({
    data: [
      // 00:30 VN ngày 21/10 — vẫn thuộc "Hôm nay", là giờ đêm, trace 2000ms.
      {
        conversationId: conversationA1.id,
        source: "AI",
        content: "Dạ bạn mặc size L ạ.",
        createdAt: new Date("2026-10-20T17:30:00Z"),
        trace: makeTrace(2000),
      },
      // 08:00 VN — biến thể khoảng trắng/hoa thường của "Size nào?".
      {
        conversationId: conversationA1.id,
        source: "BUYER",
        content: "  size   NÀO?  ",
        createdAt: new Date("2026-10-21T01:00:00Z"),
      },
      // 09:00 VN — bản gốc mới nhất để hiển thị.
      {
        conversationId: conversationA1.id,
        source: "BUYER",
        content: "Size nào?",
        createdAt: new Date("2026-10-21T02:00:00Z"),
      },
      // 09:10 VN — AI ban ngày, trace 1000ms.
      {
        conversationId: conversationA1.id,
        source: "AI",
        content: "Dạ shop tư vấn size ạ.",
        createdAt: new Date("2026-10-21T02:10:00Z"),
        trace: makeTrace(1000),
      },
      // 09:20 VN — tin AI lịch sử cũ không có trace: không được làm hỏng average.
      {
        conversationId: conversationA1.id,
        source: "AI",
        content: "Tin AI cũ chưa có truy vết.",
        createdAt: new Date("2026-10-21T02:20:00Z"),
        trace: Prisma.DbNull,
      },
      // 09:30 VN — câu hỏi thứ hai; SELLER lặp lại không được đếm.
      {
        conversationId: conversationA2.id,
        source: "BUYER",
        content: "Phí ship?",
        createdAt: new Date("2026-10-21T02:30:00Z"),
      },
      {
        conversationId: conversationA2.id,
        source: "AI",
        content: "Dạ phí ship 25.000đ ạ.",
        createdAt: new Date("2026-10-21T03:00:00Z"),
        trace: makeTrace(3000),
      },
      {
        conversationId: conversationA2.id,
        source: "SELLER",
        content: "Size nào?",
        createdAt: new Date("2026-10-21T03:05:00Z"),
      },
      // Shop B — không được cộng vào bất kỳ số AI nào của shop A.
      {
        conversationId: conversationB.id,
        source: "BUYER",
        content: "Size nào?",
        createdAt: new Date("2026-10-21T01:30:00Z"),
      },
      {
        conversationId: conversationB.id,
        source: "AI",
        content: "Dạ size L ạ.",
        createdAt: new Date("2026-10-21T01:40:00Z"),
        trace: makeTrace(9000),
      },
    ],
  });

  return {
    shopA: shopA.id,
    shopB: shopB.id,
    products: {
      A: { id: productA.id, sku: productA.sku, name: productA.name },
      B: { id: productB.id, sku: productB.sku, name: productB.name },
      C: { id: productC.id, sku: productC.sku, name: productC.name },
      D: { id: productD.id, sku: productD.sku, name: productD.name },
    },
  };
}

afterAll(async () => {
  await testPrisma.$disconnect();
});

describe("rangeBounds — biên khoảng theo lịch Việt Nam (UTC+7, không DST)", () => {
  it("today bắt đầu 00:00 VN và kết thúc ở now", () => {
    expect(rangeBounds("today", NOW)).toEqual({
      start: new Date("2026-10-20T17:00:00Z"),
      end: NOW,
    });
  });

  it("7d = todayStart - 6 ngày; 30d = todayStart - 29 ngày", () => {
    expect(rangeBounds("7d", NOW).start).toEqual(new Date("2026-10-14T17:00:00Z"));
    expect(rangeBounds("30d", NOW).start).toEqual(new Date("2026-09-21T17:00:00Z"));
    expect(rangeBounds("7d", NOW).end).toBe(NOW);
    expect(rangeBounds("30d", NOW).end).toBe(NOW);
  });

  it("giá trị lạ mặc định về 7d", () => {
    expect(rangeBounds("90d" as DashboardRange, NOW)).toEqual(
      rangeBounds("7d", NOW),
    );
  });
});

describe("getDashboardStats", () => {
  let fixture: Fixture;

  beforeEach(async () => {
    await resetDb();
    fixture = await seedFixture();
  });

  it("doanh thu chỉ tính paidAt != null trong khoảng, gồm PAID + SHIPPED, đúng shop", async () => {
    const today = await getDashboardStats(testPrisma, fixture.shopA, "today", NOW);
    const week = await getDashboardStats(testPrisma, fixture.shopA, "7d", NOW);
    const month = await getDashboardStats(testPrisma, fixture.shopA, "30d", NOW);

    // Hôm nay: 2 × 150.000; PENDING/CANCELLED và đơn shop B bị loại.
    expect(today.revenue).toBe(300_000);
    // 7d: + 220.000 (3 ngày trước) + 600.000 (SHIPPED 2 ngày trước).
    expect(week.revenue).toBe(1_120_000);
    // 30d: + 120.000 (20 ngày trước).
    expect(month.revenue).toBe(1_240_000);
  });

  it("orderCounts đếm theo createdAt; unitsSold chỉ từ đơn đã thu tiền", async () => {
    const today = await getDashboardStats(testPrisma, fixture.shopA, "today", NOW);
    const week = await getDashboardStats(testPrisma, fixture.shopA, "7d", NOW);
    const month = await getDashboardStats(testPrisma, fixture.shopA, "30d", NOW);

    expect(today.orderCounts).toEqual({
      pending: 1,
      paid: 1,
      shipped: 0,
      cancelled: 1,
    });
    expect(week.orderCounts).toEqual({
      pending: 1,
      paid: 2,
      shipped: 1,
      cancelled: 1,
    });
    expect(month.orderCounts).toEqual({
      pending: 1,
      paid: 3,
      shipped: 1,
      cancelled: 1,
    });

    expect(today.unitsSold).toBe(2);
    expect(week.unitsSold).toBe(7); // 2 + 1 + 4
    expect(month.unitsSold).toBe(8); // + 1 (20 ngày trước)
  });

  it("peakViewers = max(peakViewers) của phiên có startedAt trong khoảng", async () => {
    const today = await getDashboardStats(testPrisma, fixture.shopA, "today", NOW);
    const week = await getDashboardStats(testPrisma, fixture.shopA, "7d", NOW);
    const month = await getDashboardStats(testPrisma, fixture.shopA, "30d", NOW);

    expect(today.peakViewers).toBe(12);
    expect(week.peakViewers).toBe(40);
    // Phiên 100 viewers nằm ngoài cả 30d nên không được tính.
    expect(month.peakViewers).toBe(40);
  });

  it("hourlyRevenue có 24 bucket giờ VN và tổng bằng revenue", async () => {
    const week = await getDashboardStats(testPrisma, fixture.shopA, "7d", NOW);

    expect(week.hourlyRevenue).toHaveLength(24);
    expect(week.hourlyRevenue.map((bucket) => bucket.hour)).toEqual(
      Array.from({ length: 24 }, (_, hour) => hour),
    );

    const byHour = new Map(
      week.hourlyRevenue.map((bucket) => [bucket.hour, bucket.revenue]),
    );
    expect(byHour.get(10)).toBe(300_000); // hôm nay, 10:00 VN
    expect(byHour.get(15)).toBe(220_000); // 3 ngày trước, 15:00 VN
    expect(byHour.get(20)).toBe(600_000); // SHIPPED 2 ngày trước, 20:00 VN

    const total = week.hourlyRevenue.reduce(
      (sum, bucket) => sum + bucket.revenue,
      0,
    );
    expect(total).toBe(week.revenue);
  });

  it("topProducts chỉ gồm đơn đã thu, đúng thứ tự qty desc rồi revenue desc", async () => {
    const week = await getDashboardStats(testPrisma, fixture.shopA, "7d", NOW);
    expect(week.topProducts).toEqual([
      { sku: "SP01", name: "Áo thun basic", qty: 6, revenue: 900_000 },
      { sku: "SP02", name: "Quần jogger", qty: 1, revenue: 220_000 },
    ]);

    const month = await getDashboardStats(testPrisma, fixture.shopA, "30d", NOW);
    expect(month.topProducts).toEqual([
      { sku: "SP01", name: "Áo thun basic", qty: 6, revenue: 900_000 },
      { sku: "SP02", name: "Quần jogger", qty: 1, revenue: 220_000 },
      { sku: "SP03", name: "Nón bucket", qty: 1, revenue: 120_000 },
    ]);
  });

  it("hiệu quả AI: hội thoại, hội thoại đêm, thời gian trả lời TB và câu hỏi phổ biến", async () => {
    const today = await getDashboardStats(testPrisma, fixture.shopA, "today", NOW);

    // 2 hội thoại shop A có tin AI trong khoảng; hội thoại shop B bị loại.
    expect(today.ai.conversations).toBe(2);
    // Tin AI 00:30 VN thuộc khung đêm [22h, 6h); các tin ban ngày không tính.
    expect(today.ai.nightConversations).toBe(1);
    // (2000 + 1000 + 3000) / 3 = 2000; tin AI không trace bị bỏ qua.
    expect(today.ai.avgResponseMs).toBe(2000);

    expect(today.ai.topQuestions).toEqual([
      { text: "Size nào?", count: 2 },
      { text: "Phí ship?", count: 1 },
    ]);
  });

  it("tất cả tin AI đều không có trace thì avgResponseMs = null", async () => {
    await testPrisma.directMessage.updateMany({
      where: { source: "AI", conversation: { shopId: fixture.shopA } },
      data: { trace: Prisma.DbNull },
    });

    const today = await getDashboardStats(testPrisma, fixture.shopA, "today", NOW);

    expect(today.ai.avgResponseMs).toBeNull();
    expect(today.ai.conversations).toBe(2);
    expect(today.ai.nightConversations).toBe(1);
  });
});

describe("getDashboardStats — top 5 sản phẩm", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("chỉ trả tối đa 5 sản phẩm, sắp qty desc", async () => {
    const owner = await testPrisma.user.create({
      data: { email: "dash-top-owner@test.vn", passwordHash: "x", name: "Chủ Top", role: "SELLER" },
    });
    const buyer = await testPrisma.user.create({
      data: { email: "dash-top-buyer@test.vn", passwordHash: "x", name: "Khách Top", role: "BUYER" },
    });
    const shop = await testPrisma.shop.create({
      data: { name: "Shop Top", ownerId: owner.id },
    });

    for (let index = 1; index <= 6; index += 1) {
      const product = await testPrisma.product.create({
        data: {
          shopId: shop.id,
          sku: `T0${index}`,
          name: `Sản phẩm ${index}`,
          price: 100_000,
          stock: 20,
        },
      });
      await createOrder(shop.id, buyer.id, product.id, {
        qty: index,
        unitPrice: 100_000,
        status: "PAID",
        createdAt: new Date("2026-10-21T02:00:00Z"),
        paidAt: new Date("2026-10-21T02:05:00Z"),
      });
    }

    const today = await getDashboardStats(testPrisma, shop.id, "today", NOW);

    expect(today.topProducts).toHaveLength(5);
    expect(today.topProducts.map((row) => [row.sku, row.qty])).toEqual([
      ["T06", 6],
      ["T05", 5],
      ["T04", 4],
      ["T03", 3],
      ["T02", 2],
    ]);
    expect(today.topProducts.every((row) => row.revenue === row.qty * 100_000)).toBe(
      true,
    );
  });
});
