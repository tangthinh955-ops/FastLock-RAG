import { unstable_rethrow } from "next/navigation";
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/guards";
import { ApiError } from "@/lib/auth/service";
import { prisma } from "@/lib/db";
import { createKbEntry, parseKbInput } from "@/lib/kb/service";
import { requireSellerShop } from "@/lib/live/sessions";

/**
 * POST /api/seller/kb — thêm mục kiến thức cho shop của seller đang đăng nhập
 * (Plan 3 Task 4). Body JSON: `{ title, answer }`.
 *
 * Danh tính + shop luôn suy ra từ JWT (`requireUser` → `requireSellerShop`);
 * KHÔNG nhận `shopId` từ client. `parseKbInput` ném 400 kèm câu tiếng Việt khi
 * sai; thành công → 201 `{ entry }`. Service đã xoá index RAG của shop nên câu
 * trả lời kế tiếp dùng nội dung mới.
 */
export async function POST(request: Request) {
  try {
    const user = await requireUser("SELLER");
    const shop = await requireSellerShop(prisma, user.userId);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new ApiError(400, "Dữ liệu gửi lên không hợp lệ");
    }

    const entry = await createKbEntry(prisma, shop.id, parseKbInput(body));

    return NextResponse.json({ entry }, { status: 201 });
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
    console.error("POST /api/seller/kb lỗi:", error);
    return NextResponse.json(
      { error: "Lỗi hệ thống, vui lòng thử lại" },
      { status: 500 },
    );
  }
}
