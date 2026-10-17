import { hash } from "bcryptjs";
import { PrismaClient } from "../../generated/prisma/client";
import {
  BCRYPT_ROUNDS,
  DEMO_PASSWORD,
  SEED_KB_ENTRIES,
  SEED_PRODUCTS,
  SEED_SHOPS,
  SEED_USERS,
} from "./data";

/**
 * Client Prisma dạng instance. Seed không tự tạo kết nối: caller truyền vào
 * app singleton (`lib/db.ts`) hoặc test client (`tests/helpers/db.ts`).
 */
export type SeedPrisma = InstanceType<typeof PrismaClient>;

/**
 * Upsert toàn bộ dữ liệu nền (user demo, 2 shop, sản phẩm, KB) theo `SEED_IDS`
 * cố định → chạy lại bao nhiêu lần cũng không nhân đôi bản ghi.
 *
 * Task 4 sẽ thêm `seedHistory` (hội thoại/live cũ/đơn cũ) và gọi sau hàm này.
 */
export async function seedBase(prisma: SeedPrisma): Promise<void> {
  const passwordHash = await hash(DEMO_PASSWORD, BCRYPT_ROUNDS);

  await prisma.$transaction(async (tx) => {
    // Users trước (Shop.ownerId trỏ tới User), rồi Shop, rồi con của Shop.
    for (const user of SEED_USERS) {
      await tx.user.upsert({
        where: { id: user.id },
        update: {
          email: user.email,
          name: user.name,
          role: user.role,
          passwordHash,
        },
        create: { ...user, passwordHash },
      });
    }

    for (const shop of SEED_SHOPS) {
      await tx.shop.upsert({
        where: { id: shop.id },
        update: { name: shop.name, ownerId: shop.ownerId },
        create: shop,
      });
    }

    for (const product of SEED_PRODUCTS) {
      await tx.product.upsert({
        where: { id: product.id },
        update: {
          shopId: product.shopId,
          sku: product.sku,
          name: product.name,
          price: product.price,
          stock: product.stock,
        },
        create: product,
      });
    }

    for (const entry of SEED_KB_ENTRIES) {
      await tx.kbEntry.upsert({
        where: { id: entry.id },
        update: {
          shopId: entry.shopId,
          title: entry.title,
          answer: entry.answer,
        },
        create: entry,
      });
    }
  });
}
