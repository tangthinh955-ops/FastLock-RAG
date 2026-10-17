import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const projectRoot = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": projectRoot,
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    globalSetup: ["tests/global-setup.ts"],
    // Các file test integration dùng chung một TEST_DATABASE_URL và TRUNCATE
    // trong beforeEach — chạy song song sẽ đè dữ liệu của nhau (flaky).
    fileParallelism: false,
  },
});
