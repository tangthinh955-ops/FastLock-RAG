import type { Server } from "socket.io";

/**
 * "Sổ đăng ký" hạ tầng socket.io của process hiện tại (Task 10).
 *
 * Vì sao cần: REST route handlers (Task 11) và gateway cùng chạy trong MỘT
 * process (custom server `server.ts`) — route handler cần phát sự kiện lên
 * socket.io mà không dựng lại kết nối. `server.ts` gọi `setIo(io)` sau khi gắn
 * gateway; nơi khác chỉ đọc qua `getIo()`.
 *
 * Quyết định (ghi rõ để Task 11–14 khỏi đoán): `attachLiveGateway` KHÔNG tự gọi
 * `setIo` — registry là việc của server.ts. Nhờ vậy test dựng nhiều io server
 * độc lập không âm thầm ghi đè registry toàn cục.
 *
 * Namespace + tên phòng cũng đặt ở đây (module lá, không import gateway) để
 * gateway và fake-comments dùng chung một định nghĩa, không tạo vòng import.
 */
export const LIVE_NAMESPACE = "/live";

/** Phòng broadcast của một phiên live: `live:{sessionId}` (spec §4/§8). */
export function liveRoom(sessionId: string): string {
  return `live:${sessionId}`;
}

let io: Server | null = null;

/** Gắn instance socket.io của process (gọi một lần trong `server.ts`). */
export function setIo(server: Server): void {
  io = server;
}

/** Instance socket.io đang chạy, hoặc `null` khi chưa gắn (ví dụ script CLI). */
export function getIo(): Server | null {
  return io;
}
