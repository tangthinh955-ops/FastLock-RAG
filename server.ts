// Nạp `.env` TRƯỚC mọi import khác: `lib/db.ts` đọc `DATABASE_URL` ngay lúc
// module khởi tạo, không thể chờ tới lúc `app.prepare()` của Next mới có env.
import "dotenv/config";
import { createServer } from "node:http";
import next from "next";
import { Server } from "socket.io";
import { attachInboxGateway } from "./lib/chat/gateway";
import { prisma } from "./lib/db";
import { attachLiveGateway } from "./lib/live/gateway";
import { setInboxIo, setIo } from "./lib/socket-registry";

/**
 * Custom server của LiveOrder (Task 10): giữ nguyên pattern chính thức của
 * Next 16 (`next({ dev })` → `app.prepare()` → `app.getRequestHandler()` —
 * xem `node_modules/next/dist/docs/01-app/02-guides/custom-server.md`), rồi
 * gắn socket.io lên CÙNG http server để REST route (Task 11) và socket chung
 * một process.
 *
 * Next 16 dùng Turbopack mặc định cho cả `next dev` lẫn custom server
 * (`process.env.TURBOPACK ??= 'auto'` trong `dist/server/next.js`), nên cấu
 * hình Tailwind qua plugin `@tailwindcss/turbopack` trong `next.config.ts`
 * vẫn hiệu lực — đã kiểm tra thật ở bước manual (xem report Task 10).
 *
 * Quyết định: `attachLiveGateway` KHÔNG tự `setIo` (registry là việc của
 * server); ở đây gọi cả hai để REST một nguồn sự thật khi cùng process.
 */
const dev = process.env.NODE_ENV !== "production";
const port = Number.parseInt(process.env.PORT ?? "3000", 10);

const app = next({ dev });
const handle = app.getRequestHandler();

app
  .prepare()
  .then(() => {
    const httpServer = createServer((req, res) => {
      void handle(req, res);
    });

    const io = new Server(httpServer);
    attachLiveGateway(io, prisma);
    attachInboxGateway(io, prisma);
    setIo(io);
    setInboxIo(io);

    httpServer.listen(port, () => {
      console.log(
        `> LiveOrder (${dev ? "development" : "production"}) — Next.js tại http://localhost:${port}`,
      );
      console.log("> Socket server sẵn sàng — namespace /live và /inbox đã gắn JWT");
    });
  })
  .catch((error: unknown) => {
    console.error("> Không khởi động được server:", error);
    process.exit(1);
  });
