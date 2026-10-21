import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { ApiError } from "../lib/auth/service";
import {
  cancelOrder,
  listShopOrders,
  shipOrder,
} from "../lib/orders/service";
import { resetDb, testPrisma } from "./helpers/db";

/**
 * Integration thật trên PostgreSQL test cho quản lý đơn phía seller (Plan 3 T2):
 * liệt kê đơn của ĐÚNG shop, giao đơn PAID, hủy đơn PENDING kèm hoàn kho
 * nguyên tử, và chặn mọi thao tác chéo shop.
 *
 * Bất biến quan trọng:
 * - `cancelOrder`: `updateMany WHERE status=PENDING` trong transaction ⇒ hai
 *   lần hủy song song chỉ một lần thắng, kho chỉ cộng đúng một lần.
 * - `shipOrder`: chỉ PAID → SHIPPED; gọi lại 409.
 * - id + shopId không khớp ⇒ CÙNG một 404, không lộ đơn shop khác.
 */

type Fixture = {
  shopAId: string;
  shopBId: string;
  productAId: string;
  productBId: string;
  stockA: number;
  stockB: number;
  buyerId: string;
  buyerName: string;
};

async function seedSellerOrdersFixture(): Promise<Fixture> {
  const ownerA = await testPrisma.user.create({
    data: {
      email: "owner-a-orders@test.vn",
      passwordHash: "x",
      name: "Chủ shop A",
      role: "SELLER",
    },
  });
  const ownerB = await testPrisma.user.create({
    data: {
      email: "owner-b-orders@test.vn",
      passwordHash: "x",
      name: "Chủ shop B",
      role: "SELLER",
    },
  });
  const buyer = await testPrisma.user.create({
    data: {
      email: "buyer-seller-orders@test.vn",
      passwordHash: "x",
      name: "Khách Mua Đơn",
      role: "BUYER",
    },
  });
  const shopA = await testPrisma.shop.create({
    data: { name: "Shop A", ownerId: ownerA.id },
  });
  const shopB = await testPrisma.shop.create({
    data: { name: "Shop B", ownerId: ownerB.id },
  });
  const productA = await testPrisma.product.create({
    data: {
      shopId: shopA.id,
      sku: "SEA01",
      name: "Áo shop A",
      price: 100_000,
      stock: 10,
    },
  });
  const productB = await testPrisma.product.create({
    data: {
      shopId: shopB.id,
      sku: "SEB01",
      name: "Áo shop B",
      price: 200_000,
      stock: 5,
    },
  });

  return {
    shopAId: shopA.id,
    shopBId: shopB.id,
    productAId: productA.id,
    productBId: productB.id,
    stockA: productA.stock,
    stockB: productB.stock,
    buyerId: buyer.id,
    buyerName: buyer.name,
  };
}

let orderSeq = 0;

function createOrder(
  fixture: Fixture,
  options: {
    shop?: "A" | "B";
    qty?: number;
    status?: "PENDING" | "PAID" | "SHIPPED" | "CANCELLED";
  } = {},
) {
  orderSeq += 1;
  const isShopA = (options.shop ?? "A") === "A";
  const qty = options.qty ?? 1;
  const status = options.status ?? "PENDING";
  const productId = isShopA ? fixture.productAId : fixture.productBId;
  const unitPrice = isShopA ? 100_000 : 200_000;
  return testPrisma.order.create({
    data: {
      shopId: isShopA ? fixture.shopAId : fixture.shopBId,
      buyerId: fixture.buyerId,
      productId,
      qty,
      unitPrice,
      total: unitPrice * qty,
      status,
      paidAt: status === "PAID" || status === "SHIPPED" ? new Date() : null,
      eventId: `test-seller-orders-${orderSeq}`,
      paymentCode: `TESTSELLER${orderSeq}`,
    },
  });
}

async function readOrder(orderId: string) {
  return testPrisma.order.findUniqueOrThrow({ where: { id: orderId } });
}

async function readStock(productId: string): Promise<number> {
  const product = await testPrisma.product.findUniqueOrThrow({
    where: { id: productId },
  });
  return product.stock;
}

describe("quản lý đơn phía seller — giao/hủy (Plan 3 T2)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  it("cancelOrder PENDING → CANCELLED, kho +qty đúng 1 lần; gọi lần 2 → 409, kho không đổi", async () => {
    const fixture = await seedSellerOrdersFixture();
    const order = await createOrder(fixture, { qty: 3 });

    const cancelled = await cancelOrder(testPrisma, {
      shopId: fixture.shopAId,
      orderId: order.id,
    });

    expect(cancelled.status).toBe("CANCELLED");
    expect(cancelled.id).toBe(order.id);
    expect(cancelled.qty).toBe(3);
    expect(cancelled.product.name).toBe("Áo shop A");
    expect(cancelled.buyer.name).toBe(fixture.buyerName);
    expect(await readStock(fixture.productAId)).toBe(fixture.stockA + 3);

    await expect(
      cancelOrder(testPrisma, {
        shopId: fixture.shopAId,
        orderId: order.id,
      }),
    ).rejects.toMatchObject({ status: 409 });

    const stored = await readOrder(order.id);
    expect(stored.status).toBe("CANCELLED");
    // Kho chỉ được cộng đúng một lần dù gọi lại.
    expect(await readStock(fixture.productAId)).toBe(fixture.stockA + 3);
  });

  it("cancelOrder PAID/SHIPPED → 409, không đổi kho hay trạng thái", async () => {
    const fixture = await seedSellerOrdersFixture();
    const paid = await createOrder(fixture, { qty: 2, status: "PAID" });
    const shipped = await createOrder(fixture, { qty: 4, status: "SHIPPED" });

    await expect(
      cancelOrder(testPrisma, {
        shopId: fixture.shopAId,
        orderId: paid.id,
      }),
    ).rejects.toMatchObject({
      status: 409,
      message: "Chỉ hủy được đơn đang chờ thanh toán",
    });
    await expect(
      cancelOrder(testPrisma, {
        shopId: fixture.shopAId,
        orderId: shipped.id,
      }),
    ).rejects.toMatchObject({ status: 409 });

    expect((await readOrder(paid.id)).status).toBe("PAID");
    expect((await readOrder(shipped.id)).status).toBe("SHIPPED");
    expect(await readStock(fixture.productAId)).toBe(fixture.stockA);
  });

  it("shipOrder PAID → SHIPPED; gọi lần 2 → 409", async () => {
    const fixture = await seedSellerOrdersFixture();
    const order = await createOrder(fixture, { qty: 2, status: "PAID" });

    const shipped = await shipOrder(testPrisma, {
      shopId: fixture.shopAId,
      orderId: order.id,
    });

    expect(shipped.status).toBe("SHIPPED");
    expect(shipped.product.name).toBe("Áo shop A");
    expect(shipped.buyer.name).toBe(fixture.buyerName);
    expect((await readOrder(order.id)).status).toBe("SHIPPED");

    await expect(
      shipOrder(testPrisma, {
        shopId: fixture.shopAId,
        orderId: order.id,
      }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("shipOrder PENDING → 409, đơn vẫn PENDING", async () => {
    const fixture = await seedSellerOrdersFixture();
    const order = await createOrder(fixture);

    await expect(
      shipOrder(testPrisma, {
        shopId: fixture.shopAId,
        orderId: order.id,
      }),
    ).rejects.toMatchObject({ status: 409 });

    expect((await readOrder(order.id)).status).toBe("PENDING");
  });

  it("shop B hủy/giao đơn shop A → 404 ApiError, đơn shop A không đổi", async () => {
    const fixture = await seedSellerOrdersFixture();
    const pending = await createOrder(fixture, { qty: 2 });
    const paid = await createOrder(fixture, { qty: 1, status: "PAID" });

    const cancelError = await cancelOrder(testPrisma, {
      shopId: fixture.shopBId,
      orderId: pending.id,
    }).catch((caught: unknown) => caught);
    expect(cancelError).toBeInstanceOf(ApiError);
    expect((cancelError as ApiError).status).toBe(404);
    expect((cancelError as ApiError).message).toBe(
      "Không tìm thấy đơn của shop bạn",
    );

    const shipError = await shipOrder(testPrisma, {
      shopId: fixture.shopBId,
      orderId: paid.id,
    }).catch((caught: unknown) => caught);
    expect(shipError).toBeInstanceOf(ApiError);
    expect((shipError as ApiError).status).toBe(404);
    expect((shipError as ApiError).message).toBe(
      "Không tìm thấy đơn của shop bạn",
    );

    expect((await readOrder(pending.id)).status).toBe("PENDING");
    expect((await readOrder(paid.id)).status).toBe("PAID");
    expect(await readStock(fixture.productAId)).toBe(fixture.stockA);
  });

  it("id không tồn tại → 404 (không lộ), kho không đổi", async () => {
    const fixture = await seedSellerOrdersFixture();

    await expect(
      cancelOrder(testPrisma, {
        shopId: fixture.shopAId,
        orderId: "00000000-0000-4000-8000-000000000000",
      }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      shipOrder(testPrisma, {
        shopId: fixture.shopAId,
        orderId: "00000000-0000-4000-8000-000000000000",
      }),
    ).rejects.toMatchObject({ status: 404 });

    expect(await readStock(fixture.productAId)).toBe(fixture.stockA);
  });

  it("listShopOrders: chỉ đơn của shop, code desc, include buyer.name + product", async () => {
    const fixture = await seedSellerOrdersFixture();
    const older = await createOrder(fixture, { qty: 1, status: "PENDING" });
    const newer = await createOrder(fixture, { qty: 2, status: "PAID" });
    const otherShop = await createOrder(fixture, {
      shop: "B",
      status: "PENDING",
    });

    const list = await listShopOrders(testPrisma, fixture.shopAId);

    expect(list.map((row) => row.id)).toEqual([newer.id, older.id]);
    expect(list.every((row) => row.shopId === fixture.shopAId)).toBe(true);
    expect(list.some((row) => row.id === otherShop.id)).toBe(false);
    expect(list[0].buyer.name).toBe(fixture.buyerName);
    expect(list[0].product.name).toBe("Áo shop A");
    expect(list[0].product.sku).toBe("SEA01");
  });

  it("đua hủy: hai transaction thật → đúng 1 fulfilled, kho chỉ +qty 1 lần", async () => {
    const fixture = await seedSellerOrdersFixture();
    const qty = 4;
    const order = await createOrder(fixture, { qty });

    const results = await Promise.allSettled([
      cancelOrder(testPrisma, {
        shopId: fixture.shopAId,
        orderId: order.id,
      }),
      cancelOrder(testPrisma, {
        shopId: fixture.shopAId,
        orderId: order.id,
      }),
    ]);

    const fulfilled = results.filter(
      (result) => result.status === "fulfilled",
    );
    const rejected = results.filter((result) => result.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
      status: 409,
    });

    expect((await readOrder(order.id)).status).toBe("CANCELLED");
    // Kho chỉ được cộng đúng qty MỘT lần nhờ rollback của transaction thua.
    expect(await readStock(fixture.productAId)).toBe(fixture.stockA + qty);
  });
});
