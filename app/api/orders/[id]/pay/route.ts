import { unstable_rethrow } from "next/navigation";
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/guards";
import { ApiError } from "@/lib/auth/service";
import { toMessageEvent } from "@/lib/chat/flow";
import { emitInboxMessage } from "@/lib/chat/notify";
import { prisma } from "@/lib/db";
import { markOrderPaid } from "@/lib/orders/service";

/**
 * POST /api/orders/[id]/pay — "Giả lập đã chuyển khoản" (Plan 3 Task 1).
 *
 * Đây là ĐƯỜNG DUY NHẤT đưa đơn sang PAID, và chỉ tồn tại ở chế độ demo:
 * 1. `requireUser("BUYER")` TRƯỚC (401/403 như mọi route) — người chưa đăng
 *    nhập không được biết `DEMO_MODE` bật hay tắt;
 * 2. `DEMO_MODE !== "true"` → 403 với câu giải thích tính năng chỉ có ở demo;
 * 3. `params` là Promise (Next 16) — id đơn lấy từ URL;
 * 4. `markOrderPaid` xác thực quyền sở hữu + trạng thái trong transaction;
 * 5. Tin SYSTEM (nếu vừa tạo) được phát qua `emitInboxMessage` — service không
 *    đụng socket; gọi lại (dedup ⇒ `message === null`) không phát lại.
 *
 * Phản hồi chỉ `{ order }`: không trả row tin thô (dedupKey) ra ngoài.
 */
export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser("BUYER");
    if (process.env.DEMO_MODE !== "true") {
      return NextResponse.json(
        { error: "Tính năng giả lập thanh toán chỉ bật ở chế độ demo" },
        { status: 403 },
      );
    }

    const { id } = await context.params;
    const { order, message } = await markOrderPaid(prisma, {
      orderId: id,
      buyerId: user.userId,
    });

    if (message !== null) {
      emitInboxMessage(
        toMessageEvent(message),
        message.conversationId,
        order.shopId,
      );
    }

    return NextResponse.json({ order });
  } catch (error) {
    // `cookies()` trong `requireUser` là Request-time API — lỗi bail-out lúc
    // prerender của Next phải để Next xử lý (docs `unstable_rethrow`).
    unstable_rethrow(error);
    if (error instanceof ApiError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    }
    console.error("POST /api/orders/[id]/pay lỗi:", error);
    return NextResponse.json(
      { error: "Lỗi hệ thống, vui lòng thử lại" },
      { status: 500 },
    );
  }
}
