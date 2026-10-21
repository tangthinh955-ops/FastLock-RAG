import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { ApiError } from "../lib/auth/service";
import {
  getBuyerOrder,
  listBuyerOrders,
  markOrderPaid,
} from "../lib/orders/service";
import { paymentQrContent, renderQrDataUrl } from "../lib/orders/qr";
import { resetDb, testPrisma } from "./helpers/db";

/**
 * Integration thật trên PostgreSQL test cho nền đơn hàng phía khách (Plan 3 T1):
 * danh sách/chi tiết đơn của đúng buyer + đường DUY NHẤT để PAID
 * (`markOrderPaid`) kèm đúng một tin SYSTEM vào Inbox.
 *
 * Bất biến quan trọng:
 * - `updateMany` lọc id + buyerId + status PENDING trong transaction ⇒ người
 *   khác gọi hay gọi lần hai đều 409 và không đổi dữ liệu.
 * - Tin SYSTEM dedup mức DB `order:{id}:paid` ⇒ gọi lại không nhân tin.
 * - Service KHÔNG phát socket (route phát) — test chạy offline, QR sinh local.
 */

type Fixture = {
  shopId: string;
  buyerId: string;
  otherBuyerId: string;
  productId: string;
  productName: string;
  price: number;
};

async function seedOrdersFixture(): Promise<Fixture> {
  const owner = await testPrisma.user.create({
    data: {
      email: "owner-orders@test.vn",
      passwordHash: "x",
      name: "Chủ shop Đơn",
      role: "SELLER",
    },
  });
  const buyer = await testPrisma.user.create({
    data: {
      email: "buyer-orders@test.vn",
      passwordHash: "x",
      name: "Khách Đơn",
      role: "BUYER",
    },
  });
  const otherBuyer = await testPrisma.user.create({
    data: {
      email: "buyer-orders-2@test.vn",
      passwordHash: "x",
      name: "Khách Khác",
      role: "BUYER",
    },
  });
  const shop = await testPrisma.shop.create({
    data: { name: "Shop Đơn Hàng", ownerId: owner.id },
  });
  const product = await testPrisma.product.create({
    data: {
      shopId: shop.id,
      sku: "OD01",
      name: "Áo thun basic",
      price: 120_000,
      stock: 10,
    },
  });

  return {
    shopId: shop.id,
    buyerId: buyer.id,
    otherBuyerId: otherBuyer.id,
    productId: product.id,
    productName: product.name,
    price: product.price,
  };
}

let orderSeq = 0;

function createOrder(
  fixture: Fixture,
  options: {
    buyerId?: string;
    qty?: number;
    status?: "PENDING" | "PAID";
  } = {},
) {
  orderSeq += 1;
  const qty = options.qty ?? 1;
  const status = options.status ?? "PENDING";
  return testPrisma.order.create({
    data: {
      shopId: fixture.shopId,
      buyerId: options.buyerId ?? fixture.buyerId,
      productId: fixture.productId,
      qty,
      unitPrice: fixture.price,
      total: fixture.price * qty,
      status,
      paidAt: status === "PAID" ? new Date() : null,
      eventId: `test-orders-${orderSeq}`,
      paymentCode: `TESTOD${orderSeq}`,
    },
  });
}

describe("đơn hàng phía khách — service + QR (Plan 3 T1)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  it("markOrderPaid: PENDING → PAID, paidAt set, đúng 1 tin SYSTEM + hội thoại", async () => {
    const fixture = await seedOrdersFixture();
    const order = await createOrder(fixture, { qty: 2 });

    const result = await markOrderPaid(testPrisma, {
      orderId: order.id,
      buyerId: fixture.buyerId,
    });

    expect(result.order.status).toBe("PAID");
    expect(result.order.paidAt).not.toBeNull();
    expect(result.order.product.name).toBe(fixture.productName);
    expect(result.order.shop.id).toBe(fixture.shopId);

    // DB: đơn đã PAID kèm paidAt.
    const stored = await testPrisma.order.findUniqueOrThrow({
      where: { id: order.id },
    });
    expect(stored.status).toBe("PAID");
    expect(stored.paidAt).not.toBeNull();

    // Đúng một tin SYSTEM với dedupKey + orderId + nội dung.
    expect(result.message).not.toBeNull();
    const message = result.message!;
    expect(message.source).toBe("SYSTEM");
    expect(message.dedupKey).toBe(`order:${order.id}:paid`);
    expect(message.orderId).toBe(order.id);
    expect(message.content).toContain(`#${order.code}`);
    expect(message.content).toContain("Áo thun basic ×2");
    expect(message.content).toContain("240.000đ");

    const systemRows = await testPrisma.directMessage.findMany({
      where: { source: "SYSTEM" },
    });
    expect(systemRows).toHaveLength(1);

    // Hội thoại buyer ↔ shop được tạo đúng cặp, tin nằm trong đó.
    const conversations = await testPrisma.conversation.findMany();
    expect(conversations).toHaveLength(1);
    expect(conversations[0].buyerId).toBe(fixture.buyerId);
    expect(conversations[0].shopId).toBe(fixture.shopId);
    expect(message.conversationId).toBe(conversations[0].id);
  });

  it("markOrderPaid lần 2 → 409, vẫn 1 tin SYSTEM, paidAt không đổi", async () => {
    const fixture = await seedOrdersFixture();
    const order = await createOrder(fixture);

    const first = await markOrderPaid(testPrisma, {
      orderId: order.id,
      buyerId: fixture.buyerId,
    });
    const paidAt = first.order.paidAt;

    await expect(
      markOrderPaid(testPrisma, {
        orderId: order.id,
        buyerId: fixture.buyerId,
      }),
    ).rejects.toMatchObject({ status: 409 });

    const stored = await testPrisma.order.findUniqueOrThrow({
      where: { id: order.id },
    });
    expect(stored.paidAt?.toISOString()).toBe(paidAt?.toISOString());
    expect(
      await testPrisma.directMessage.count({ where: { source: "SYSTEM" } }),
    ).toBe(1);
  });

  it("buyer khác gọi → 409, đơn vẫn PENDING, không có tin SYSTEM", async () => {
    const fixture = await seedOrdersFixture();
    const order = await createOrder(fixture);

    const error = await markOrderPaid(testPrisma, {
      orderId: order.id,
      buyerId: fixture.otherBuyerId,
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(409);

    const stored = await testPrisma.order.findUniqueOrThrow({
      where: { id: order.id },
    });
    expect(stored.status).toBe("PENDING");
    expect(stored.paidAt).toBeNull();
    expect(await testPrisma.directMessage.count()).toBe(0);
    expect(await testPrisma.conversation.count()).toBe(0);
  });

  it("listBuyerOrders: chỉ đơn của buyer, sort code desc, include product/shop", async () => {
    const fixture = await seedOrdersFixture();
    const older = await createOrder(fixture, { qty: 1 });
    const newer = await createOrder(fixture, { qty: 2 });
    const other = await createOrder(fixture, { buyerId: fixture.otherBuyerId });

    const list = await listBuyerOrders(testPrisma, fixture.buyerId);

    expect(list.map((row) => row.id)).toEqual([newer.id, older.id]);
    expect(list.map((row) => row.code)).toEqual([newer.code, older.code]);
    expect(list.some((row) => row.id === other.id)).toBe(false);
    // include đủ quan hệ để trang `/orders` không phải query thêm.
    expect(list[0].product.name).toBe(fixture.productName);
    expect(list[0].shop.name).toBe("Shop Đơn Hàng");
  });

  it("getBuyerOrder: null khi buyer sai, trả đơn khi đúng buyer", async () => {
    const fixture = await seedOrdersFixture();
    const order = await createOrder(fixture);

    expect(
      await getBuyerOrder(testPrisma, fixture.otherBuyerId, order.id),
    ).toBeNull();
    expect(
      await getBuyerOrder(
        testPrisma,
        fixture.buyerId,
        "00000000-0000-4000-8000-000000000000",
      ),
    ).toBeNull();

    const found = await getBuyerOrder(testPrisma, fixture.buyerId, order.id);
    expect(found?.id).toBe(order.id);
    expect(found?.product.name).toBe(fixture.productName);
    expect(found?.shop.id).toBe(fixture.shopId);
  });

  it("QR: nội dung chứa paymentCode/#code/total; data URL PNG local", async () => {
    const fixture = await seedOrdersFixture();
    const order = await createOrder(fixture, { qty: 3 });

    const content = paymentQrContent(order);
    expect(content).toContain("LIVEORDER-DEMO");
    expect(content).toContain(order.paymentCode);
    expect(content).toContain(`#${order.code}`);
    expect(content).toContain(String(order.total));

    const dataUrl = await renderQrDataUrl(content);
    expect(dataUrl.startsWith("data:image/png;base64,")).toBe(true);
    expect(dataUrl.length).toBeGreaterThan(100);
  });
});
