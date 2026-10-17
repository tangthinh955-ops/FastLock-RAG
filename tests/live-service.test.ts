import { createHash } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  processComment,
  type OrderSummary,
  type ProcessCommentInput,
  type ProcessCommentResult,
} from "../lib/live/service";
import { seedBase } from "../prisma/seed/base";
import { SEED_IDS } from "../prisma/seed/ids";
import { resetDb, testPrisma } from "./helpers/db";

/**
 * Integration thật trên PostgreSQL test: service là hàm thuần nhận prisma
 * (cùng đường code với socket gateway Task 10 — khác mỗi connection string).
 * Mỗi test tự tạo phiên live mới (id ngẫu nhiên) nên chỉ mục SKU giữ theo
 * phiên của service không rò rỉ trạng thái sang test khác.
 */
describe("live service — comment → bắt SKU → tạo đơn + trừ kho atomic", () => {
  beforeEach(async () => {
    await resetDb();
    await seedBase(testPrisma);
  });

  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  /** Danh tính buyer Khách — đúng shape TokenPayload mà socket.data.user dùng. */
  const KHACH: ProcessCommentInput["user"] = {
    userId: SEED_IDS.users.khach,
    name: "Khách",
    role: "BUYER",
  };

  /** Buyer thứ hai cho kịch bản hai khách cùng chốt. */
  const HONG: ProcessCommentInput["user"] = {
    userId: SEED_IDS.users.hong,
    name: "Hồng",
    role: "BUYER",
  };

  async function createLiveSession(shopId: string = SEED_IDS.shops.linh) {
    return testPrisma.liveSession.create({
      data: { shopId, title: "Phiên test", status: "LIVE" },
    });
  }

  async function stockOf(productId: string): Promise<number> {
    const product = await testPrisma.product.findUniqueOrThrow({
      where: { id: productId },
    });
    return product.stock;
  }

  /** Gọi processComment cho đường "thành công" — sai hợp đồng thì fail ngay. */
  async function runComment(
    input: ProcessCommentInput,
  ): Promise<Extract<ProcessCommentResult, { ok: true }>> {
    const result = await processComment(testPrisma, input);
    if (!result.ok) {
      throw new Error(`processComment từ chối: ${result.reason}`);
    }
    return result;
  }

  function requireOrder(
    result: Extract<ProcessCommentResult, { ok: true }>,
  ): OrderSummary {
    if (!result.order) {
      throw new Error("Kết quả không kèm đơn");
    }
    return result.order;
  }

  it("(a) 'SP01 2 cái' khi kho 8 → đơn qty 2 · 300.000đ, kho còn 6, eventId/paymentCode đúng hợp đồng", async () => {
    const session = await createLiveSession();

    const result = await runComment({
      sessionId: session.id,
      user: KHACH,
      rawText: "SP01 2 cái",
      clientNonce: "nonce-a",
    });

    expect(result.text).toBe("SP01 2 cái");
    expect(result.matches).toEqual([{ sku: "SP01", start: 0, end: 4 }]);
    expect(Number.isFinite(result.elapsedMs)).toBe(true);
    expect(result.duplicate).toBeUndefined();
    expect(result.outOfStockSku).toBeUndefined();

    const order = requireOrder(result);
    expect(order.code).toBeGreaterThan(0);
    expect(order.sku).toBe("SP01");
    expect(order.productName).toBe("Áo thun basic");
    expect(order.qty).toBe(2);
    expect(order.total).toBe(300_000);
    expect(order.status).toBe("PENDING");

    // Bản ghi DB phải khớp hợp đồng: snapshot giá, đúng shop/phiên/người mua,
    // eventId = sha1(phiên|user|nonce|sku), paymentCode 'PAY' + 8 ký tự base36.
    const dbOrder = await testPrisma.order.findUniqueOrThrow({
      where: { id: order.id },
    });
    expect({
      shopId: dbOrder.shopId,
      buyerId: dbOrder.buyerId,
      productId: dbOrder.productId,
      qty: dbOrder.qty,
      unitPrice: dbOrder.unitPrice,
      total: dbOrder.total,
      status: dbOrder.status,
      liveSessionId: dbOrder.liveSessionId,
    }).toEqual({
      shopId: SEED_IDS.shops.linh,
      buyerId: SEED_IDS.users.khach,
      productId: SEED_IDS.products.linh_sp01,
      qty: 2,
      unitPrice: 150_000,
      total: 300_000,
      status: "PENDING",
      liveSessionId: session.id,
    });

    const expectedEventId = createHash("sha1")
      .update(`${session.id}|${SEED_IDS.users.khach}|nonce-a|SP01`)
      .digest("hex");
    expect(dbOrder.eventId).toBe(expectedEventId);
    expect(dbOrder.paymentCode).toMatch(/^PAY[0-9a-z]{8}$/);

    expect(await stockOf(SEED_IDS.products.linh_sp01)).toBe(6);
  });

  it("(b) text không có SKU → ok, matches rỗng, không tạo đơn", async () => {
    const session = await createLiveSession();

    const result = await runComment({
      sessionId: session.id,
      user: KHACH,
      rawText: "áo đẹp quá",
    });

    expect(result.text).toBe("áo đẹp quá");
    expect(result.matches).toEqual([]);
    expect(result.order).toBeUndefined();
    expect(result.outOfStockSku).toBeUndefined();
    expect(await testPrisma.order.count()).toBe(0);
  });

  it("(c) SĐT trước SKU bị che trước khi parse — match trỏ đúng chuỗi phát đi", async () => {
    const session = await createLiveSession();

    const result = await runComment({
      sessionId: session.id,
      user: KHACH,
      rawText: "0912 345 678 SP01 1 cái",
      clientNonce: "nonce-c",
    });

    // Parse trên chuỗi ĐÃ che: highlight của Task 10/14 cắt từ chính `text` này.
    expect(result.text).toBe("0912***678 SP01 1 cái");
    expect(result.text).not.toContain("345");
    expect(result.matches).toHaveLength(1);
    const match = result.matches[0];
    expect(result.text.slice(match.start, match.end)).toBe("SP01");
    expect(match.sku).toBe("SP01");

    expect(requireOrder(result).qty).toBe(1);
    expect(await stockOf(SEED_IDS.products.linh_sp01)).toBe(7);
  });

  it("(d) cùng nonce gửi lại → duplicate:true, cùng đơn, kho chỉ giảm một lần", async () => {
    const session = await createLiveSession();
    const input: ProcessCommentInput = {
      sessionId: session.id,
      user: KHACH,
      rawText: "SP03 3 cái",
      clientNonce: "nonce-dup",
    };

    const first = await runComment(input);
    const firstOrder = requireOrder(first);
    expect(first.duplicate).toBeUndefined();
    expect(await stockOf(SEED_IDS.products.linh_sp03)).toBe(7);

    const second = await runComment(input);
    expect(second.duplicate).toBe(true);
    expect(requireOrder(second).id).toBe(firstOrder.id);
    expect(second.matches).toEqual(first.matches);

    expect(await testPrisma.order.count()).toBe(1);
    expect(await stockOf(SEED_IDS.products.linh_sp03)).toBe(7);
  });

  it("(d2) cùng nonce gửi SONG SONG → vẫn chỉ 1 đơn, đúng một kết quả duplicate:true (race pre-check/P2002)", async () => {
    const session = await createLiveSession();
    const input: ProcessCommentInput = {
      sessionId: session.id,
      user: KHACH,
      rawText: "SP05 2 cái",
      clientNonce: "nonce-race",
    };

    const results = await Promise.all([runComment(input), runComment(input)]);

    // Bất kể request nào thắng, retry cùng nonce phải quy về đúng một đơn:
    // pre-check bắt được (tuần tự) hay unique `eventId` bắt được (chèn nhau P2002).
    const duplicates = results.filter((r) => r.duplicate === true);
    expect(duplicates).toHaveLength(1);
    expect(requireOrder(results[0]).id).toBe(requireOrder(results[1]).id);

    expect(await testPrisma.order.count()).toBe(1);
    expect(await stockOf(SEED_IDS.products.linh_sp05)).toBe(4);
  });

  it("(d3) race P2002: hai request cùng nonce cùng lọt pre-check → unique eventId chặn, kho hoàn khi rollback", async () => {
    const session = await createLiveSession();
    const input: ProcessCommentInput = {
      sessionId: session.id,
      user: KHACH,
      rawText: "SP05 2 cái",
      clientNonce: "nonce-lock",
    };

    // Giữ row lock trên sản phẩm để cả HAI request đi qua pre-check (chưa ai
    // commit được Order), rồi thả lock: request thứ hai chắc chắn đụng unique
    // `eventId` (P2002) → transaction rollback (kho đã trừ cũng hoàn) → nhánh
    // bắt P2002 trả đơn cũ với duplicate:true.
    let releaseLock = (): void => {};
    const lockReleased = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });

    const gate = testPrisma.$transaction(async (tx) => {
      await tx.$queryRawUnsafe(
        `SELECT id FROM "Product" WHERE id = $1 FOR UPDATE`,
        SEED_IDS.products.linh_sp05,
      );
      await lockReleased;
    });

    await new Promise((resolve) => setTimeout(resolve, 100));
    const pending = Promise.all([runComment(input), runComment(input)]);
    // Đủ lâu để cả hai request qua pre-check và xếp hàng chờ row lock.
    await new Promise((resolve) => setTimeout(resolve, 300));
    releaseLock();

    await gate;
    const results = await pending;

    expect(results.filter((r) => r.duplicate === true)).toHaveLength(1);
    expect(requireOrder(results[0]).id).toBe(requireOrder(results[1]).id);
    expect(await testPrisma.order.count()).toBe(1);
    expect(await stockOf(SEED_IDS.products.linh_sp05)).toBe(4);
  });

  it("(e) kho = 1, hai khách Promise.all → đúng 1 đơn + 1 outOfStockSku, kho cuối 0", async () => {
    const session = await createLiveSession();
    await testPrisma.product.update({
      where: { id: SEED_IDS.products.linh_sp04 },
      data: { stock: 1 },
    });

    const results = await Promise.all([
      runComment({
        sessionId: session.id,
        user: KHACH,
        rawText: "SP04 1 cái",
        clientNonce: "nonce-e1",
      }),
      runComment({
        sessionId: session.id,
        user: HONG,
        rawText: "SP04 1 cái",
        clientNonce: "nonce-e2",
      }),
    ]);

    const winners = results.filter((r) => r.order !== undefined);
    const losers = results.filter((r) => r.outOfStockSku !== undefined);

    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);
    expect(losers[0].outOfStockSku).toBe("SP04");
    expect(losers[0].order).toBeUndefined();

    expect(await testPrisma.order.count()).toBe(1);
    expect(await stockOf(SEED_IDS.products.linh_sp04)).toBe(0);

    const dbOrder = await testPrisma.order.findUniqueOrThrow({
      where: { id: requireOrder(winners[0]).id },
    });
    expect([SEED_IDS.users.khach, SEED_IDS.users.hong]).toContain(dbOrder.buyerId);
  });

  it("(f) phiên ENDED hoặc không tồn tại → NO_LIVE_SESSION", async () => {
    const ended = await testPrisma.liveSession.create({
      data: { shopId: SEED_IDS.shops.linh, title: "Đã kết thúc", status: "ENDED" },
    });

    const onEnded = await processComment(testPrisma, {
      sessionId: ended.id,
      user: KHACH,
      rawText: "SP01 1 cái",
    });
    expect(onEnded).toEqual({ ok: false, reason: "NO_LIVE_SESSION" });

    const onMissing = await processComment(testPrisma, {
      sessionId: "00000000-0000-4000-8000-000000000000",
      user: KHACH,
      rawText: "SP01 1 cái",
    });
    expect(onMissing).toEqual({ ok: false, reason: "NO_LIVE_SESSION" });

    expect(await testPrisma.order.count()).toBe(0);
  });

  it("text trắng → EMPTY_TEXT; phiên chết được ưu tiên báo trước nội dung", async () => {
    const live = await createLiveSession();

    const blank = await processComment(testPrisma, {
      sessionId: live.id,
      user: KHACH,
      rawText: "   ",
    });
    expect(blank).toEqual({ ok: false, reason: "EMPTY_TEXT" });

    // Thứ tự kiểm tra đã chốt: phiên không LIVE thắng cả text trắng.
    const ended = await testPrisma.liveSession.create({
      data: { shopId: SEED_IDS.shops.linh, title: "Đã kết thúc", status: "ENDED" },
    });
    const blankOnEnded = await processComment(testPrisma, {
      sessionId: ended.id,
      user: KHACH,
      rawText: "",
    });
    expect(blankOnEnded).toEqual({ ok: false, reason: "NO_LIVE_SESSION" });

    expect(await testPrisma.order.count()).toBe(0);
  });

  describe("(g) quy tắc số lượng sau mã", () => {
    it("'SP02 mình lấy 2 nha' → 2 (số cách 11 ký tự vẫn trong cửa sổ 20)", async () => {
      const session = await createLiveSession();
      const result = await runComment({
        sessionId: session.id,
        user: KHACH,
        rawText: "SP02 mình lấy 2 nha",
        clientNonce: "nonce-g1",
      });
      const order = requireOrder(result);
      expect(order.qty).toBe(2);
      expect(order.total).toBe(440_000);
      expect(await stockOf(SEED_IDS.products.linh_sp02)).toBe(3);
    });

    it("'SP02 nha' → 1", async () => {
      const session = await createLiveSession();
      const result = await runComment({
        sessionId: session.id,
        user: KHACH,
        rawText: "SP02 nha",
        clientNonce: "nonce-g2",
      });
      expect(requireOrder(result).qty).toBe(1);
      expect(await stockOf(SEED_IDS.products.linh_sp02)).toBe(4);
    });

    it("'2 SP02' → 1 (số nằm TRƯỚC mã không tính)", async () => {
      const session = await createLiveSession();
      const result = await runComment({
        sessionId: session.id,
        user: KHACH,
        rawText: "2 SP02",
        clientNonce: "nonce-g3",
      });
      expect(requireOrder(result).qty).toBe(1);
    });

    it("'SP011' → không match (ranh giới từ), không tạo đơn", async () => {
      const session = await createLiveSession();
      const result = await runComment({
        sessionId: session.id,
        user: KHACH,
        rawText: "SP011",
        clientNonce: "nonce-g4",
      });
      expect(result.matches).toEqual([]);
      expect(result.order).toBeUndefined();
      expect(await testPrisma.order.count()).toBe(0);
    });

    it("'SP07 12' → hai chữ số vẫn bắt đủ 12; 'SP03 0 cái' → clamp sàn 1", async () => {
      const session = await createLiveSession();

      const twoDigits = await runComment({
        sessionId: session.id,
        user: KHACH,
        rawText: "SP07 12",
        clientNonce: "nonce-g7",
      });
      expect(requireOrder(twoDigits).qty).toBe(12);
      expect(await stockOf(SEED_IDS.products.linh_sp07)).toBe(0);

      const zero = await runComment({
        sessionId: session.id,
        user: KHACH,
        rawText: "SP03 0 cái",
        clientNonce: "nonce-g8",
      });
      expect(requireOrder(zero).qty).toBe(1);
      expect(await stockOf(SEED_IDS.products.linh_sp03)).toBe(9);
    });

    it("chỉ xử lý match ĐẦU TIÊN: 'SP01 … SP02' → highlight cả hai nhưng đơn chỉ cho SP01", async () => {
      const session = await createLiveSession();

      const result = await runComment({
        sessionId: session.id,
        user: KHACH,
        rawText: "SP01 nha nha nha nha nha SP02",
        clientNonce: "nonce-g9",
      });

      expect(result.matches.map((match) => match.sku)).toEqual(["SP01", "SP02"]);

      const order = requireOrder(result);
      expect(order.sku).toBe("SP01");
      expect(order.qty).toBe(1);
      expect(await stockOf(SEED_IDS.products.linh_sp01)).toBe(7);
      expect(await stockOf(SEED_IDS.products.linh_sp02)).toBe(5);
    });

    it("cửa sổ đúng 20 ký tự sau mã: vị trí 20 còn tính, vị trí 21 thì không", async () => {
      const session = await createLiveSession();

      const inWindow = await runComment({
        sessionId: session.id,
        user: KHACH,
        rawText: `SP02${" ".repeat(19)}2`,
        clientNonce: "nonce-g5",
      });
      expect(requireOrder(inWindow).qty).toBe(2);

      const outWindow = await runComment({
        sessionId: session.id,
        user: KHACH,
        rawText: `SP03${" ".repeat(20)}2`,
        clientNonce: "nonce-g6",
      });
      expect(requireOrder(outWindow).qty).toBe(1);
    });
  });

  describe("chống lẫn shop (SP01 có ở cả hai shop, giá khác nhau)", () => {
    it("live Bảo An: 'SP01 1 cái' → dùng SP01 của Bảo An (200.000đ), kho Linh nguyên", async () => {
      const session = await createLiveSession(SEED_IDS.shops.baoan);

      const result = await runComment({
        sessionId: session.id,
        user: KHACH,
        rawText: "SP01 1 cái",
        clientNonce: "nonce-shop-b",
      });

      const order = requireOrder(result);
      expect(order.sku).toBe("SP01");
      expect(order.productName).toBe("Áo sơ mi công sở");
      expect(order.total).toBe(200_000);

      const dbOrder = await testPrisma.order.findUniqueOrThrow({
        where: { id: order.id },
      });
      expect(dbOrder.shopId).toBe(SEED_IDS.shops.baoan);
      expect(dbOrder.productId).toBe(SEED_IDS.products.baoan_sp01);

      expect(await stockOf(SEED_IDS.products.baoan_sp01)).toBe(4);
      expect(await stockOf(SEED_IDS.products.linh_sp01)).toBe(8);
    });

    it("live Linh: 'SP01 1 cái' → dùng SP01 của Linh (150.000đ), kho Bảo An nguyên", async () => {
      const session = await createLiveSession(SEED_IDS.shops.linh);

      const result = await runComment({
        sessionId: session.id,
        user: KHACH,
        rawText: "SP01 1 cái",
        clientNonce: "nonce-shop-a",
      });

      const dbOrder = await testPrisma.order.findUniqueOrThrow({
        where: { id: requireOrder(result).id },
      });
      expect(dbOrder.productId).toBe(SEED_IDS.products.linh_sp01);
      expect(dbOrder.unitPrice).toBe(150_000);

      expect(await stockOf(SEED_IDS.products.linh_sp01)).toBe(7);
      expect(await stockOf(SEED_IDS.products.baoan_sp01)).toBe(5);
    });

    it("mã riêng của shop khác không được bắt: 'SP07' (chỉ Linh có) trong live Bảo An → không match, không đơn", async () => {
      const session = await createLiveSession(SEED_IDS.shops.baoan);

      const result = await runComment({
        sessionId: session.id,
        user: KHACH,
        rawText: "SP07 1 cái",
        clientNonce: "nonce-foreign",
      });

      expect(result.matches).toEqual([]);
      expect(result.order).toBeUndefined();
      expect(await testPrisma.order.count()).toBe(0);
    });
  });

  it("mã khớp nhưng sản phẩm đã bị xoá khỏi shop → ok + matches, không đơn, không outOfStockSku", async () => {
    const session = await createLiveSession();

    // Lần gọi đầu dựng chỉ mục SKU theo phiên (kể cả khi không có match nào).
    await runComment({
      sessionId: session.id,
      user: KHACH,
      rawText: "xin chào",
    });

    // Seller xoá sản phẩm ngay giữa phiên: chỉ mục của phiên vẫn còn SP07,
    // nhưng tra cứu theo (shop, sku) không còn sản phẩm — chỉ highlight, không đơn.
    await testPrisma.product.delete({ where: { id: SEED_IDS.products.linh_sp07 } });

    const result = await runComment({
      sessionId: session.id,
      user: KHACH,
      rawText: "SP07 1 cái",
      clientNonce: "nonce-stale",
    });

    expect(result.matches).toEqual([{ sku: "SP07", start: 0, end: 4 }]);
    expect(result.order).toBeUndefined();
    expect(result.outOfStockSku).toBeUndefined();
    expect(await testPrisma.order.count()).toBe(0);
  });

  it("seller bình luận vẫn theo đúng pipeline (quyết định: không đặc cách role) → đơn thuộc chính seller", async () => {
    const session = await createLiveSession();

    const result = await runComment({
      sessionId: session.id,
      user: { userId: SEED_IDS.users.linh, name: "Linh", role: "SELLER" },
      rawText: "SP01 1 cái",
      clientNonce: "nonce-seller",
    });

    const dbOrder = await testPrisma.order.findUniqueOrThrow({
      where: { id: requireOrder(result).id },
    });
    expect(dbOrder.buyerId).toBe(SEED_IDS.users.linh);
  });
});
