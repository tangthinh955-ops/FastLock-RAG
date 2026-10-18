import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getActiveLive } from "@/lib/live/sessions";

/**
 * GET /api/live/active — danh sách phiên live đang mở (công khai, không cần
 * đăng nhập). Dùng cho Trang chủ (Task 12) và các chỗ cần biết shop nào đang
 * lên sóng mà không muốn query DB trực tiếp.
 *
 * Hợp đồng phản hồi (shape tối giản, ĐÃ CHỐT cho Task 12–14):
 * ```json
 * { "sessions": [ { "id": "<sessionId>", "title": "…", "shopName": "…" } ] }
 * ```
 * - `id` là id PHIÊN (không phải shop) — dùng thẳng cho link `/live/{id}`.
 * - Sắp mới nhất trước (`startedAt` giảm dần); rỗng khi không ai live.
 *
 * Route này KHÔNG đọc cookie nên không cần `unstable_rethrow` (R17 chỉ áp cho
 * route gọi `requireUser`). Query DB làm route chạy ở request time — đúng ý
 * (Cache Components dừng prerender khi gặp truy vấn DB, xem docs Next 16).
 */
export async function GET() {
  try {
    const active = await getActiveLive(prisma);

    return NextResponse.json({
      sessions: active.map(({ session, shop }) => ({
        id: session.id,
        title: session.title,
        shopName: shop.name,
      })),
    });
  } catch (error) {
    console.error("GET /api/live/active lỗi:", error);
    return NextResponse.json(
      { error: "Lỗi hệ thống, vui lòng thử lại" },
      { status: 500 },
    );
  }
}
