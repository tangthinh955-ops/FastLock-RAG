import { compare } from "bcryptjs";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { Role } from "../generated/prisma/client";
import { seedBase } from "../prisma/seed/base";
import { SEED_IDS } from "../prisma/seed/ids";
import { resetDb, testPrisma } from "./helpers/db";

/** Spec §9 — bảng sản phẩm shop Thời Trang Linh, đúng thứ tự SP01…SP07. */
const LINH_PRODUCTS = [
  { sku: "SP01", name: "Áo thun basic", price: 150_000, stock: 8 },
  { sku: "SP02", name: "Quần jogger", price: 220_000, stock: 5 },
  { sku: "SP03", name: "Nón bucket", price: 120_000, stock: 10 },
  { sku: "SP04", name: "Quần short jean", price: 260_000, stock: 4 },
  { sku: "SP05", name: "Áo polo", price: 150_000, stock: 6 },
  { sku: "SP06", name: "Áo khoác gió", price: 320_000, stock: 3 },
  { sku: "SP07", name: "Túi tote", price: 120_000, stock: 12 },
] as const;

/** Controller chốt: shop Bảo An có 3 sản phẩm, SP01 trùng mã nhưng khác giá/KB. */
const BAOAN_PRODUCTS = [
  { sku: "SP01", name: "Áo sơ mi công sở", price: 200_000, stock: 5 },
  { sku: "SP02", name: "Quần âu công sở", price: 250_000, stock: 4 },
  { sku: "SP03", name: "Thắt lưng da", price: 180_000, stock: 6 },
] as const;

async function snapshotCounts() {
  const [users, shops, products, kbEntries] = await Promise.all([
    testPrisma.user.count(),
    testPrisma.shop.count(),
    testPrisma.product.count(),
    testPrisma.kbEntry.count(),
  ]);
  return { users, shops, products, kbEntries };
}

describe("seedBase — dữ liệu nền 2 shop cho demo", () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  describe("sau một lần chạy seedBase(testPrisma)", () => {
    beforeEach(async () => {
      await seedBase(testPrisma);
    });

    it("tạo đúng 5 tài khoản demo: 3 BUYER (khách + Hồng + Minh Tú), 2 SELLER", async () => {
      const users = await testPrisma.user.findMany({
        orderBy: { email: "asc" },
      });

      expect(users.map((u) => [u.email, u.name, u.role])).toEqual([
        ["baoan@demo.vn", "Bảo An", Role.SELLER],
        ["hong@demo.vn", "Hồng", Role.BUYER],
        ["khach@demo.vn", "Khách", Role.BUYER],
        ["linh@demo.vn", "Linh", Role.SELLER],
        ["minh@demo.vn", "Minh Tú", Role.BUYER],
      ]);

      // Id cố định để các task sau (live/order/inbox) trỏ thẳng tới.
      const khach = await testPrisma.user.findUniqueOrThrow({
        where: { id: SEED_IDS.users.khach },
      });
      expect(khach.email).toBe("khach@demo.vn");
      const linh = await testPrisma.user.findUniqueOrThrow({
        where: { id: SEED_IDS.users.linh },
      });
      expect(linh.email).toBe("linh@demo.vn");

      // Mật khẩu demo là demo123 — băm bcrypt, không lưu plaintext.
      for (const user of users) {
        expect(user.passwordHash).not.toBe("demo123");
        expect(await compare("demo123", user.passwordHash)).toBe(true);
      }
    });

    it("tạo 2 shop, mỗi shop đúng chủ sở hữu (SELLER)", async () => {
      const shops = await testPrisma.shop.findMany({
        include: { owner: true },
      });
      expect(shops).toHaveLength(2);

      const linh = shops.find((s) => s.id === SEED_IDS.shops.linh);
      const baoan = shops.find((s) => s.id === SEED_IDS.shops.baoan);

      expect(linh?.name).toBe("Shop Thời Trang Linh");
      expect(linh?.owner.email).toBe("linh@demo.vn");
      expect(linh?.owner.role).toBe(Role.SELLER);
      expect(linh?.ownerId).toBe(SEED_IDS.users.linh);

      expect(baoan?.name).toBe("Shop Áo Sơ Mi Bảo An");
      expect(baoan?.owner.email).toBe("baoan@demo.vn");
      expect(baoan?.owner.role).toBe(Role.SELLER);
      expect(baoan?.ownerId).toBe(SEED_IDS.users.baoan);
    });

    it("shop Linh có đúng 7 sản phẩm SP01…SP07 theo spec §9", async () => {
      const products = await testPrisma.product.findMany({
        where: { shopId: SEED_IDS.shops.linh },
        orderBy: { sku: "asc" },
      });

      expect(
        products.map(({ sku, name, price, stock }) => ({
          sku,
          name,
          price,
          stock,
        })),
      ).toEqual([...LINH_PRODUCTS]);

      // Spot-check 2 sản phẩm chủ đạo của kịch bản demo.
      const sp01 = await testPrisma.product.findUniqueOrThrow({
        where: { id: SEED_IDS.products.linh_sp01 },
      });
      expect({ sku: sp01.sku, price: sp01.price, stock: sp01.stock }).toEqual({
        sku: "SP01",
        price: 150_000,
        stock: 8,
      });

      const sp06 = await testPrisma.product.findUniqueOrThrow({
        where: { id: SEED_IDS.products.linh_sp06 },
      });
      expect({ sku: sp06.sku, price: sp06.price, stock: sp06.stock }).toEqual({
        sku: "SP06",
        price: 320_000,
        stock: 3,
      });
    });

    it("shop Bảo An có 3 sản phẩm — SP01 'Áo sơ mi công sở' 200.000đ/kho 5", async () => {
      const products = await testPrisma.product.findMany({
        where: { shopId: SEED_IDS.shops.baoan },
        orderBy: { sku: "asc" },
      });

      expect(
        products.map(({ sku, name, price, stock }) => ({
          sku,
          name,
          price,
          stock,
        })),
      ).toEqual([...BAOAN_PRODUCTS]);

      const sp01 = await testPrisma.product.findUniqueOrThrow({
        where: { id: SEED_IDS.products.baoan_sp01 },
      });
      expect({ sku: sp01.sku, price: sp01.price, stock: sp01.stock }).toEqual({
        sku: "SP01",
        price: 200_000,
        stock: 5,
      });

      // Cùng mã SP01 nhưng là 2 bản ghi riêng của 2 shop (chống lẫn shop).
      const sp01All = await testPrisma.product.findMany({
        where: { sku: "SP01" },
      });
      expect(sp01All.map((p) => p.id).sort()).toEqual(
        [SEED_IDS.products.linh_sp01, SEED_IDS.products.baoan_sp01].sort(),
      );
    });

    it("KB: shop Linh 6 entries đủ chủ đề, Bảo An 3 entries riêng — điều khoản khác nhau", async () => {
      const linhKb = await testPrisma.kbEntry.findMany({
        where: { shopId: SEED_IDS.shops.linh },
      });
      const baoanKb = await testPrisma.kbEntry.findMany({
        where: { shopId: SEED_IDS.shops.baoan },
      });

      expect(linhKb).toHaveLength(6);
      expect(baoanKb).toHaveLength(3);

      // Mọi entry đều thuộc đúng shop và có nội dung thật để RAG dùng.
      for (const entry of [...linhKb, ...baoanKb]) {
        expect(entry.answer.trim().length).toBeGreaterThan(80);
      }

      // So khớp chủ đề không phân biệt hoa/thường (cách viết hoa là chi tiết chữ).
      const linhTitles = linhKb.map((e) => e.title.toLowerCase()).join(" | ");
      for (const topic of [
        "bảng size",
        "đổi trả",
        "hàng lỗi",
        "vận chuyển",
        "chốt đơn",
        "khuyến mãi",
      ]) {
        expect(linhTitles).toContain(topic);
      }

      const baoanTitles = baoanKb.map((e) => e.title.toLowerCase()).join(" | ");
      for (const topic of ["bảng size", "đổi trả", "ship"]) {
        expect(baoanTitles).toContain(topic);
      }

      // Contrast chống lẫn shop: đổi trả 7 ngày (Linh) vs 3 ngày (Bảo An).
      const linhReturn = linhKb.find((e) =>
        e.title.toLowerCase().includes("đổi trả"),
      );
      const baoanReturn = baoanKb.find((e) =>
        e.title.toLowerCase().includes("đổi trả"),
      );
      expect(linhReturn?.answer).toContain("7 ngày");
      expect(linhReturn?.answer).not.toContain("3 ngày");
      expect(baoanReturn?.answer).toContain("3 ngày");
      expect(baoanReturn?.answer).not.toContain("7 ngày");
    });
  });

  it("chạy seedBase lần hai chỉ upsert — không nhân đôi dữ liệu", async () => {
    await seedBase(testPrisma);
    const afterFirst = await snapshotCounts();
    expect(afterFirst).toEqual({
      users: 5,
      shops: 2,
      products: 10,
      kbEntries: 9,
    });

    await seedBase(testPrisma);
    expect(await snapshotCounts()).toEqual(afterFirst);

    expect(
      await testPrisma.user.count({ where: { email: "khach@demo.vn" } }),
    ).toBe(1);
    expect(
      await testPrisma.product.count({ where: { shopId: SEED_IDS.shops.linh } }),
    ).toBe(7);
    expect(
      await testPrisma.kbEntry.count({ where: { shopId: SEED_IDS.shops.linh } }),
    ).toBe(6);
  });
});
