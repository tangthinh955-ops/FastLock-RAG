import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { ApiError } from "../lib/auth/service";
import {
  endLive,
  getActiveLive,
  requireSellerShop,
  requireShopLiveSession,
  startLive,
  type EndLiveResult,
} from "../lib/live/sessions";
import { seedBase } from "../prisma/seed/base";
import { SEED_IDS } from "../prisma/seed/ids";
import { resetDb, testPrisma } from "./helpers/db";

/**
 * Integration thật trên PostgreSQL test cho service phiên live (Task 11):
 * `startLive` / `endLive` / `getActiveLive` + hai guard dùng bởi route seller.
 *
 * Vì sao test ở tầng lib (không gọi route handler): route handler đọc cookie
 * qua `next/headers` (chỉ sống trong request scope của Next) và import `lib/db`
 * trỏ DATABASE_URL dev — test integration không được chạm. Route chỉ là lớp
 * mỏng (parse body → requireUser → các hàm ở đây → phát socket); đường HTTP
 * được kiểm bằng curl trong bước manual (xem report).
 */
describe("live sessions — start/end/active (Task 11)", () => {
  beforeEach(async () => {
    await resetDb();
    await seedBase(testPrisma);
  });

  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  /** Assert promise ném ra ApiError đúng status + message — tránh lặp try/catch. */
  async function expectApiError(
    promise: Promise<unknown>,
    status: number,
    message: string,
  ): Promise<void> {
    const error = await promise.catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(status);
    expect((error as ApiError).message).toBe(message);
  }

  let orderSeq = 0;

  /** Đơn tạo thẳng trong phiên (không qua pipeline comment) để test summary. */
  function createOrderInSession(
    sessionId: string,
    shopId: string,
    options: {
      total: number;
      status: "PENDING" | "PAID" | "SHIPPED" | "CANCELLED";
      paidAt?: Date;
    },
  ) {
    orderSeq += 1;
    return testPrisma.order.create({
      data: {
        shopId,
        buyerId: SEED_IDS.users.khach,
        productId:
          shopId === SEED_IDS.shops.baoan
            ? SEED_IDS.products.baoan_sp01
            : SEED_IDS.products.linh_sp01,
        qty: 1,
        unitPrice: options.total,
        total: options.total,
        status: options.status,
        paidAt: options.paidAt ?? null,
        eventId: `test-live-sessions-${orderSeq}`,
        paymentCode: `TESTLS${orderSeq}`,
        liveSessionId: sessionId,
      },
    });
  }

  describe("startLive", () => {
    it("(a) tạo phiên LIVE đúng shop, tiêu đề được trim", async () => {
      const session = await startLive(
        testPrisma,
        SEED_IDS.shops.linh,
        "  Live tối thứ Bảy  ",
      );

      expect(session.status).toBe("LIVE");
      expect(session.shopId).toBe(SEED_IDS.shops.linh);
      expect(session.title).toBe("Live tối thứ Bảy");
      expect(session.startedAt).toBeInstanceOf(Date);
      expect(session.endedAt).toBeNull();
      expect(session.peakViewers).toBe(0);

      const dbSession = await testPrisma.liveSession.findUniqueOrThrow({
        where: { id: session.id },
      });
      expect(dbSession.status).toBe("LIVE");
    });

    it("(b) shop đang LIVE → 409 đúng thông báo pin, không tạo phiên thứ hai", async () => {
      await startLive(testPrisma, SEED_IDS.shops.linh, "Phiên một");

      await expectApiError(
        startLive(testPrisma, SEED_IDS.shops.linh, "Phiên hai"),
        409,
        "Shop đang có live khác",
      );

      const liveCount = await testPrisma.liveSession.count({
        where: { shopId: SEED_IDS.shops.linh, status: "LIVE" },
      });
      expect(liveCount).toBe(1);
    });

    it("tiêu đề trắng → 400 tiếng Việt (validate server-side vì API public cho seller)", async () => {
      await expectApiError(
        startLive(testPrisma, SEED_IDS.shops.linh, "   "),
        400,
        "Vui lòng nhập tiêu đề live",
      );
      expect(await testPrisma.liveSession.count()).toBe(0);
    });
  });

  describe("endLive", () => {
    it("(c) summary: orderCount = mọi đơn của phiên, paidRevenue = tổng đơn có paidAt", async () => {
      const session = await startLive(
        testPrisma,
        SEED_IDS.shops.linh,
        "Live chốt đơn",
      );
      await createOrderInSession(session.id, SEED_IDS.shops.linh, {
        total: 300_000,
        status: "PAID",
        paidAt: new Date(),
      });
      await createOrderInSession(session.id, SEED_IDS.shops.linh, {
        total: 150_000,
        status: "PENDING",
      });

      const result = await endLive(testPrisma, session.id);

      expect(result.summary).toEqual({ orderCount: 2, paidRevenue: 300_000 });
      expect(result.session.status).toBe("ENDED");
    });

    it("(Task 8) end-live nhắc ngay đơn PENDING còn lại (1 tin/đơn qua dedup), PAID không nhắc", async () => {
      const session = await startLive(
        testPrisma,
        SEED_IDS.shops.linh,
        "Live còn đơn chờ tiền",
      );
      const pending1 = await createOrderInSession(session.id, SEED_IDS.shops.linh, {
        total: 150_000,
        status: "PENDING",
      });
      const pending2 = await createOrderInSession(session.id, SEED_IDS.shops.linh, {
        total: 240_000,
        status: "PENDING",
      });
      const paid = await createOrderInSession(session.id, SEED_IDS.shops.linh, {
        total: 300_000,
        status: "PAID",
        paidAt: new Date(),
      });

      await endLive(testPrisma, session.id);

      const rows = await testPrisma.directMessage.findMany({
        where: { source: "SYSTEM" },
      });
      expect(new Set(rows.map((row) => row.dedupKey))).toEqual(
        new Set([
          `order:${pending1.id}:remind`,
          `order:${pending2.id}:remind`,
        ]),
      );
      expect(
        await testPrisma.directMessage.count({
          where: { dedupKey: `order:${paid.id}:remind` },
        }),
      ).toBe(0);

      // Cả hai tin rơi vào MỘT hội thoại buyer ↔ shop của đơn.
      const conversation = await testPrisma.conversation.findFirstOrThrow();
      expect(conversation.buyerId).toBe(SEED_IDS.users.khach);
      expect(conversation.shopId).toBe(SEED_IDS.shops.linh);
      expect(rows.every((row) => row.conversationId === conversation.id)).toBe(
        true,
      );
    });

    it("(R4) đơn SHIPPED cũng đã thu tiền: paidRevenue gồm SHIPPED, KHÔNG gồm CANCELLED", async () => {
      const session = await startLive(
        testPrisma,
        SEED_IDS.shops.linh,
        "Live có đơn giao",
      );
      await createOrderInSession(session.id, SEED_IDS.shops.linh, {
        total: 200_000,
        status: "PAID",
        paidAt: new Date(),
      });
      await createOrderInSession(session.id, SEED_IDS.shops.linh, {
        total: 260_000,
        status: "SHIPPED",
        paidAt: new Date(),
      });
      await createOrderInSession(session.id, SEED_IDS.shops.linh, {
        total: 120_000,
        status: "CANCELLED",
      });

      const result = await endLive(testPrisma, session.id);

      expect(result.summary).toEqual({ orderCount: 3, paidRevenue: 460_000 });
    });

    it("cập nhật status ENDED, endedAt và lưu peakViewers truyền vào", async () => {
      const session = await startLive(
        testPrisma,
        SEED_IDS.shops.linh,
        "Live đông khách",
      );
      const before = Date.now();

      const result = await endLive(testPrisma, session.id, 42);

      expect(result.session.status).toBe("ENDED");
      expect(result.session.endedAt).toBeInstanceOf(Date);
      expect(result.session.endedAt!.getTime()).toBeGreaterThanOrEqual(before);
      expect(result.session.peakViewers).toBe(42);

      const dbSession = await testPrisma.liveSession.findUniqueOrThrow({
        where: { id: session.id },
      });
      expect(dbSession.status).toBe("ENDED");
      expect(dbSession.endedAt).toBeInstanceOf(Date);
      expect(dbSession.peakViewers).toBe(42);
    });

    it("không truyền peak → mặc định 0 (không có số giả lập)", async () => {
      const session = await startLive(
        testPrisma,
        SEED_IDS.shops.linh,
        "Live không giả lập",
      );

      const result = await endLive(testPrisma, session.id);

      expect(result.session.peakViewers).toBe(0);
    });

    it("phiên không tồn tại → 404; phiên đã ENDED → 409 (không end hai lần)", async () => {
      await expectApiError(
        endLive(testPrisma, "11111111-1111-4111-8111-111111111111"),
        404,
        "Không tìm thấy phiên live",
      );

      const session = await startLive(
        testPrisma,
        SEED_IDS.shops.linh,
        "Live một lần",
      );
      const first: EndLiveResult = await endLive(testPrisma, session.id);
      expect(first.session.status).toBe("ENDED");

      await expectApiError(
        endLive(testPrisma, session.id),
        409,
        "Phiên live đã kết thúc",
      );
    });

    it("hai request end song song → đúng một request thắng, request kia 409, không ghi đè lần hai", async () => {
      const session = await startLive(
        testPrisma,
        SEED_IDS.shops.linh,
        "Live double-click",
      );

      const results = await Promise.allSettled([
        endLive(testPrisma, session.id, 11),
        endLive(testPrisma, session.id, 99),
      ]);

      const fulfilled = results.filter(
        (result): result is PromiseFulfilledResult<EndLiveResult> =>
          result.status === "fulfilled",
      );
      const rejected = results.filter(
        (result): result is PromiseRejectedResult =>
          result.status === "rejected",
      );
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);

      const winner = fulfilled[0].value;
      expect(winner.session.status).toBe("ENDED");
      expect(winner.session.endedAt).toBeInstanceOf(Date);
      expect([11, 99]).toContain(winner.session.peakViewers);

      expect(rejected[0].reason).toBeInstanceOf(ApiError);
      expect((rejected[0].reason as ApiError).status).toBe(409);
      expect((rejected[0].reason as ApiError).message).toBe(
        "Phiên live đã kết thúc",
      );

      // Chỉ lần ghi của request thắng tồn tại — peak/endedAt khớp kết quả đó,
      // không bị lần ghi thua (peak còn lại) đè lên.
      const dbSession = await testPrisma.liveSession.findUniqueOrThrow({
        where: { id: session.id },
      });
      expect(dbSession.status).toBe("ENDED");
      expect(dbSession.endedAt!.getTime()).toBe(
        winner.session.endedAt!.getTime(),
      );
      expect(dbSession.peakViewers).toBe(winner.session.peakViewers);
    });

    it("summary đếm đúng theo phiên: đơn của phiên khác không lẫn vào", async () => {
      const session = await startLive(
        testPrisma,
        SEED_IDS.shops.linh,
        "Live đối chứng",
      );
      const otherSession = await testPrisma.liveSession.create({
        data: {
          shopId: SEED_IDS.shops.linh,
          title: "Phiên cũ",
          status: "ENDED",
          endedAt: new Date(),
        },
      });
      await createOrderInSession(otherSession.id, SEED_IDS.shops.linh, {
        total: 500_000,
        status: "PAID",
        paidAt: new Date(),
      });
      await createOrderInSession(session.id, SEED_IDS.shops.linh, {
        total: 150_000,
        status: "PAID",
        paidAt: new Date(),
      });

      const result = await endLive(testPrisma, session.id);

      expect(result.summary).toEqual({ orderCount: 1, paidRevenue: 150_000 });
    });
  });

  describe("guard seller — requireSellerShop / requireShopLiveSession", () => {
    it("(d) seller2 kết thúc phiên của shop mình trong khi shop khác đang live → 404 pin, phiên shop 1 nguyên vẹn", async () => {
      const session = await startLive(
        testPrisma,
        SEED_IDS.shops.linh,
        "Live shop Linh",
      );

      // Route /api/seller/live/end của seller2 tra theo ownerId shop Bảo An —
      // shop Bảo An không có phiên LIVE nên về 404 (pin, không phải 403: không
      // tiết lộ phiên của shop khác có tồn tại hay không).
      await expectApiError(
        requireShopLiveSession(testPrisma, SEED_IDS.shops.baoan),
        404,
        "Không tìm thấy phiên live của shop bạn",
      );

      const stillLive = await testPrisma.liveSession.findUniqueOrThrow({
        where: { id: session.id },
      });
      expect(stillLive.status).toBe("LIVE");
    });

    it("requireShopLiveSession trả đúng phiên LIVE của shop mình (bỏ qua phiên ENDED)", async () => {
      await testPrisma.liveSession.create({
        data: {
          shopId: SEED_IDS.shops.linh,
          title: "Phiên cũ đã xong",
          status: "ENDED",
          endedAt: new Date(),
        },
      });
      const live = await startLive(
        testPrisma,
        SEED_IDS.shops.linh,
        "Live hiện tại",
      );

      const found = await requireShopLiveSession(
        testPrisma,
        SEED_IDS.shops.linh,
      );

      expect(found.id).toBe(live.id);
      expect(found.status).toBe("LIVE");
    });

    it("requireSellerShop trả shop theo ownerId; seller chưa có shop → 403", async () => {
      const shop = await requireSellerShop(testPrisma, SEED_IDS.users.linh);
      expect(shop.id).toBe(SEED_IDS.shops.linh);
      expect(shop.name).toBe("Shop Thời Trang Linh");

      // Seller không có hàng Shop (dữ liệu bất thường ngoài seed — tài khoản
      // đăng ký mới luôn là BUYER nên chỉ dựng được bằng DB trực tiếp).
      const sellerNoShop = await testPrisma.user.create({
        data: {
          email: "sellershop@demo.vn",
          passwordHash: "hash-test",
          name: "Seller Không Shop",
          role: "SELLER",
        },
      });

      await expectApiError(
        requireSellerShop(testPrisma, sellerNoShop.id),
        403,
        "Tài khoản của bạn chưa có shop",
      );
    });
  });

  describe("getActiveLive", () => {
    it("chỉ trả phiên LIVE kèm shop, mới nhất trước; phiên ENDED không xuất hiện", async () => {
      // Dựng trực tiếp để kiểm soát thứ tự startedAt (startLive luôn dùng now).
      const older = await testPrisma.liveSession.create({
        data: {
          shopId: SEED_IDS.shops.linh,
          title: "Live sớm",
          status: "LIVE",
          startedAt: new Date("2026-10-17T08:00:00.000Z"),
        },
      });
      const newer = await testPrisma.liveSession.create({
        data: {
          shopId: SEED_IDS.shops.baoan,
          title: "Live muộn",
          status: "LIVE",
          startedAt: new Date("2026-10-17T09:00:00.000Z"),
        },
      });
      await testPrisma.liveSession.create({
        data: {
          shopId: SEED_IDS.shops.linh,
          title: "Live cũ đã xong",
          status: "ENDED",
          startedAt: new Date("2026-10-16T08:00:00.000Z"),
          endedAt: new Date("2026-10-16T09:00:00.000Z"),
        },
      });

      const active = await getActiveLive(testPrisma);

      expect(active).toHaveLength(2);
      expect(active.map((row) => row.session.id)).toEqual([
        newer.id,
        older.id,
      ]);
      expect(active[0].shop.id).toBe(SEED_IDS.shops.baoan);
      expect(active[0].shop.name).toBe("Shop Áo Sơ Mi Bảo An");
      expect(active[1].shop.name).toBe("Shop Thời Trang Linh");
    });

    it("không có phiên LIVE nào (kể cả sau khi end) → []", async () => {
      expect(await getActiveLive(testPrisma)).toEqual([]);

      const session = await startLive(
        testPrisma,
        SEED_IDS.shops.linh,
        "Live duy nhất",
      );
      expect(await getActiveLive(testPrisma)).toHaveLength(1);

      await endLive(testPrisma, session.id);

      expect(await getActiveLive(testPrisma)).toEqual([]);
    });
  });
});
