import "dotenv/config";
import { prisma } from "../../lib/db";
import { seedBase } from "./base";
import { SEED_KB_ENTRIES, SEED_PRODUCTS, SEED_SHOPS, SEED_USERS } from "./data";

/**
 * CLI seed (`npm run seed`): upsert dữ liệu nền theo UUID cố định.
 * Task 4 sẽ gọi thêm `seedHistory(prisma)` sau `seedBase`.
 */
async function main(): Promise<void> {
  await seedBase(prisma);

  console.log(
    [
      "Seed nền xong:",
      `${SEED_USERS.length} tài khoản demo,`,
      `${SEED_SHOPS.length} shop,`,
      `${SEED_PRODUCTS.length} sản phẩm,`,
      `${SEED_KB_ENTRIES.length} KB entries.`,
    ].join(" "),
  );
}

main()
  .catch((error: unknown) => {
    console.error("Seed nền thất bại:", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
