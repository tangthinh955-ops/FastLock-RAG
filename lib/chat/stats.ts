import type { ChatPrisma } from "./service";

/**
 * Thống kê Inbox (Task 10 — dây C, spec §8.4): số hội thoại có AI trả lời trong
 * khung "trực đêm" 22h–6h, dùng cho badge "🌙 AI đã xử lý N hội thoại trong đêm"
 * ở `/seller/inbox` (và nền cho khối "Hiệu quả AI" của Dashboard — Plan 3).
 *
 * Quy tắc thời gian: `DirectMessage.createdAt` lưu UTC, nhưng "đêm" là khái niệm
 * theo giờ người dùng Việt Nam — luôn quy đổi bằng `Intl` với `timeZone` cố định
 * `Asia/Ho_Chi_Minh`, KHÔNG dựa vào timezone của máy chủ (badge phải ra cùng một
 * số trên mọi môi trường, kể cả CI đặt TZ=UTC).
 */

/**
 * Giờ Việt Nam (0–23) của một mốc UTC.
 *
 * `hourCycle: "h23"` ép nửa đêm về "0" (nhiều ICU trả "24" với `hour12: false`);
 * `hour: "numeric"` một mình nên chuỗi format chỉ là con số.
 */
const VN_HOUR_FORMATTER = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Ho_Chi_Minh",
  hour: "numeric",
  hourCycle: "h23",
});

export function vietnamHour(at: Date): number {
  return Number(VN_HOUR_FORMATTER.format(at));
}

/** Khung đêm [22:00, 06:00) giờ VN — 22:00 tính, 06:00 KHÔNG tính. */
const NIGHT_START_HOUR = 22;
const NIGHT_END_HOUR = 6;

/**
 * Giờ VN `hour` có thuộc khung đêm [22:00, 06:00) không. Tách riêng để
 * Dashboard (Plan 3) dùng chung đúng một định nghĩa "đêm" với badge Inbox.
 */
export function isNightHour(hour: number): boolean {
  return hour >= NIGHT_START_HOUR || hour < NIGHT_END_HOUR;
}

/**
 * Đếm số hội thoại KHÁC NHAU của shop có ≥1 tin `source = AI` với giờ VN trong
 * `[22:00, 06:00)`. Nhiều tin đêm trong cùng hội thoại chỉ tính một lần; tin
 * BUYER/SELLER/SYSTEM lúc đêm không ảnh hưởng (AI mới là "trực đêm").
 *
 * Quét theo shop qua quan hệ `conversation` (một query, không N+1) rồi lọc giờ
 * bằng `Intl` — quy mô demo, đọc đủ tin AI một shop vẫn rẻ; nếu dữ liệu lớn hơn
 * thì tối ưu bằng khoảng `createdAt` UTC (VN = UTC+7 nên khung đêm là
 * 15:00–23:00 UTC mỗi ngày) mà không đổi hành vi.
 */
export async function countAiConversationsAtNight(
  prisma: ChatPrisma,
  shopId: string,
): Promise<number> {
  const aiMessages = await prisma.directMessage.findMany({
    where: { source: "AI", conversation: { shopId } },
    select: { conversationId: true, createdAt: true },
  });

  const nightConversations = new Set<string>();
  for (const message of aiMessages) {
    const hour = vietnamHour(message.createdAt);
    if (isNightHour(hour)) {
      nightConversations.add(message.conversationId);
    }
  }
  return nightConversations.size;
}
