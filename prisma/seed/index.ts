import "dotenv/config";
import { prisma } from "../../lib/db";
import { seedBase } from "./base";
import { SEED_KB_ENTRIES, SEED_PRODUCTS, SEED_SHOPS, SEED_USERS } from "./data";
import {
  SEED_HISTORY_CONVERSATIONS,
  SEED_HISTORY_ORDERS,
  SEED_HISTORY_SESSIONS,
  seedHistory,
} from "./history";

/**
 * CLI seed (`npm run seed`): upsert dữ liệu nền theo UUID cố định (Task 3),
 * rồi seed lịch sử hội thoại/live cũ/đơn cũ (Task 4).
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

  await seedHistory(prisma);

  const historyMessageCount = SEED_HISTORY_CONVERSATIONS.reduce(
    (total, conversation) => total + conversation.messages.length,
    0,
  );

  console.log(
    [
      "Seed lịch sử xong:",
      `${SEED_HISTORY_CONVERSATIONS.length} hội thoại (${historyMessageCount} tin nhắn),`,
      `${SEED_HISTORY_SESSIONS.length} phiên live cũ,`,
      `${SEED_HISTORY_ORDERS.length} đơn lịch sử.`,
    ].join(" "),
  );
}

main()
  .catch((error: unknown) => {
    console.error("Seed thất bại:", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
