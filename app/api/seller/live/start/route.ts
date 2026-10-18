import { unstable_rethrow } from "next/navigation";
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/guards";
import { ApiError } from "@/lib/auth/service";
import { prisma } from "@/lib/db";
import { startFakeComments } from "@/lib/live/fake-comments";
import { requireSellerShop, startLive } from "@/lib/live/sessions";
import { getIo, LIVE_NAMESPACE } from "@/lib/socket-registry";

/**
 * POST /api/seller/live/start — mở phiên live cho shop của seller đang đăng nhập.
 * Body `{ title: string }`. Chỉ SELLER (401/403 từ `requireUser`).
 *
 * Luồng: `requireUser('SELLER')` → tra shop theo `ownerId` → `startLive` (409 khi
 * shop đang có live khác) → phát `live_started` lên namespace `/live` + bật giả
 * lập khách. Phản hồi `{ session: { id, title, shopName } }` — ĐÚNG cùng shape
 * `live_started` để Task 13 dùng thẳng không phải chuyển đổi.
 *
 * Socket chỉ là kênh phụ: `getIo()` trả `null` khi process không có custom server
 * (ví dụ `next dev` thuần, curl trong test) — khi đó bỏ qua phát im lặng, REST
 * vẫn 200. Nhờ vậy route không bao giờ chết vì thiếu socket server.
 */
export async function POST(request: Request) {
  let body: { title?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Dữ liệu gửi lên không hợp lệ" },
      { status: 400 },
    );
  }

  try {
    const payload = await requireUser("SELLER");
    const shop = await requireSellerShop(prisma, payload.userId);
    const session = await startLive(
      prisma,
      shop.id,
      typeof body.title === "string" ? body.title : "",
    );

    const io = getIo();
    if (io) {
      io.of(LIVE_NAMESPACE).emit("live_started", {
        session: { id: session.id, title: session.title, shopName: shop.name },
      });
      // Giả lập khách (spec §8.7): `startFakeComments` tự no-op khi
      // `DEMO_MODE !== 'true'` — route không cần kiểm tra lại env.
      startFakeComments(io, session.id, shop.name);
    }

    return NextResponse.json({
      session: { id: session.id, title: session.title, shopName: shop.name },
    });
  } catch (error) {
    // R17 (ruling của controller): `cookies()` mà `requireUser` gọi bên trong là
    // Request-time API — lỗi bail-out lúc prerender của Next phải để Next xử lý,
    // không được nuốt vào nhánh 500 (docs Next 16 `unstable_rethrow`).
    unstable_rethrow(error);
    if (error instanceof ApiError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    }
    console.error("POST /api/seller/live/start lỗi:", error);
    return NextResponse.json(
      { error: "Lỗi hệ thống, vui lòng thử lại" },
      { status: 500 },
    );
  }
}
