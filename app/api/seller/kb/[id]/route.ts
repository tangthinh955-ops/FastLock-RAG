import { unstable_rethrow } from "next/navigation";
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/guards";
import { ApiError } from "@/lib/auth/service";
import { prisma } from "@/lib/db";
import {
  deleteKbEntry,
  parseKbInput,
  updateKbEntry,
} from "@/lib/kb/service";
import { requireSellerShop } from "@/lib/live/sessions";

/**
 * PATCH/DELETE một mục kiến thức (Plan 3 Task 4). `params` là Promise theo
 * Next 16.
 *
 * Cả hai đều lấy shop từ JWT (không tin client). id không thuộc shop mình hoặc
 * không tồn tại → CÙNG một 404 “Không tìm thấy mục kiến thức của shop bạn”,
 * không lộ nội dung của shop khác. Xoá luôn được (không có FK tham chiếu).
 */

/** Hợp đồng lỗi chung của hai handler trong file này. */
function handleError(error: unknown, tag: string) {
  // `cookies()` trong `requireUser` là Request-time API — lỗi bail-out lúc
  // prerender của Next phải để Next xử lý, không được nuốt vào nhánh 500.
  unstable_rethrow(error);
  if (error instanceof ApiError) {
    return NextResponse.json(
      { error: error.message },
      { status: error.status },
    );
  }
  console.error(`${tag} lỗi:`, error);
  return NextResponse.json(
    { error: "Lỗi hệ thống, vui lòng thử lại" },
    { status: 500 },
  );
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser("SELLER");
    const shop = await requireSellerShop(prisma, user.userId);
    const { id } = await context.params;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new ApiError(400, "Dữ liệu gửi lên không hợp lệ");
    }

    const entry = await updateKbEntry(
      prisma,
      shop.id,
      id,
      parseKbInput(body),
    );

    return NextResponse.json({ entry });
  } catch (error) {
    return handleError(error, "PATCH /api/seller/kb/[id]");
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser("SELLER");
    const shop = await requireSellerShop(prisma, user.userId);
    const { id } = await context.params;

    await deleteKbEntry(prisma, shop.id, id);

    // 204 không body — client chỉ cần biết thành công rồi `router.refresh()`.
    return new Response(null, { status: 204 });
  } catch (error) {
    return handleError(error, "DELETE /api/seller/kb/[id]");
  }
}
