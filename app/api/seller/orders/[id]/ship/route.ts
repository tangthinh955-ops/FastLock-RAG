import { unstable_rethrow } from "next/navigation";
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/guards";
import { ApiError } from "@/lib/auth/service";
import { prisma } from "@/lib/db";
import { requireSellerShop } from "@/lib/live/sessions";
import { shipOrder } from "@/lib/orders/service";

/**
 * POST /api/seller/orders/[id]/ship — giao một đơn ĐÃ THANH TOÁN (PAID →
 * SHIPPED) của CHÍNH shop seller đang đăng nhập (Plan 3 Task 2).
 *
 * Danh tính + shop luôn suy ra từ JWT (`requireUser` → `requireSellerShop`);
 * KHÔNG nhận `shopId` từ client. id đơn không thuộc shop mình (hoặc không tồn
 * tại) → 404 "Không tìm thấy đơn của shop bạn"; sai trạng thái → 409.
 * `params` là Promise theo Next 16.
 */
export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser("SELLER");
    const shop = await requireSellerShop(prisma, user.userId);
    const { id } = await context.params;

    const order = await shipOrder(prisma, {
      shopId: shop.id,
      orderId: id,
    });

    return NextResponse.json({ order });
  } catch (error) {
    // `cookies()` trong `requireUser` là Request-time API — lỗi bail-out lúc
    // prerender của Next phải để Next xử lý, không được nuốt vào nhánh 500.
    unstable_rethrow(error);
    if (error instanceof ApiError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    }
    console.error("POST /api/seller/orders/[id]/ship lỗi:", error);
    return NextResponse.json(
      { error: "Lỗi hệ thống, vui lòng thử lại" },
      { status: 500 },
    );
  }
}
