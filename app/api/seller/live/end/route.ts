import { unstable_rethrow } from "next/navigation";
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/guards";
import { ApiError } from "@/lib/auth/service";
import { getFakeCommentPeak, stopFakeComments } from "@/lib/live/fake-comments";
import {
  endLive,
  requireSellerShop,
  requireShopLiveSession,
} from "@/lib/live/sessions";
import { prisma } from "@/lib/db";
import { getIo, LIVE_NAMESPACE } from "@/lib/socket-registry";

/**
 * POST /api/seller/live/end — kết thúc phiên live của CHÍNH shop seller đang
 * đăng nhập. Chỉ SELLER (401/403 từ `requireUser`).
 *
 * Không nhận `sessionId` từ client: phiên cần kết thúc được suy ra từ shop của
 * người gọi (`requireShopLiveSession`) — một nguồn sự thật, giống luật "danh
 * tính chỉ từ JWT" (spec §7.1). Shop chưa mở live (hoặc chỉ shop KHÁC đang live)
 * → 404 pin "Không tìm thấy phiên live của shop bạn", không tiết lộ phiên của
 * shop khác có tồn tại hay không.
 *
 * Luồng: tắt giả lập TRƯỚC, đọc peak đã lưu trong RAM (gateway sống cùng
 * process) → `endLive` lưu `status ENDED` + `endedAt` + `peakViewers` → phát
 * `live_ended`. Đọc peak sau khi stop để một tick 4–8s chen giữa không làm số
 * đã chốt tăng thêm; `getFakeCommentPeak` vẫn trả peak lưu lại sau stop. Phản
 * hồi `{ session, summary: { orderCount, paidRevenue } }` — Task 13 hiển thị
 * trong popup tổng kết.
 */
export async function POST() {
  try {
    const payload = await requireUser("SELLER");
    const shop = await requireSellerShop(prisma, payload.userId);
    const session = await requireShopLiveSession(prisma, shop.id);

    // Stop trước rồi mới đọc peak: stop lưu chốt peak cuối vào store toàn cục;
    // đọc trước có thể lỡ một tick 4–8s ngay sau đó làm peak tăng sau khi lấy.
    stopFakeComments(session.id);
    const result = await endLive(
      prisma,
      session.id,
      getFakeCommentPeak(session.id),
    );

    // Như route start: thiếu socket server thì bỏ qua im lặng, REST vẫn thành công.
    getIo()
      ?.of(LIVE_NAMESPACE)
      .emit("live_ended", { sessionId: result.session.id });

    return NextResponse.json(result);
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
    console.error("POST /api/seller/live/end lỗi:", error);
    return NextResponse.json(
      { error: "Lỗi hệ thống, vui lòng thử lại" },
      { status: 500 },
    );
  }
}
