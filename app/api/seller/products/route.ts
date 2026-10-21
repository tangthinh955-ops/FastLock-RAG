import { unstable_rethrow } from "next/navigation";
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/guards";
import { ApiError } from "@/lib/auth/service";
import { prisma } from "@/lib/db";
import { requireSellerShop } from "@/lib/live/sessions";
import { createProduct, parseProductInput } from "@/lib/products/service";

/**
 * POST /api/seller/products — tạo sản phẩm cho shop của seller đang đăng nhập
 * (Plan 3 Task 3). Body JSON: `{ sku, name, price, stock, imageUrl? }`.
 *
 * Danh tính + shop luôn suy ra từ JWT (`requireUser` → `requireSellerShop`);
 * KHÔNG nhận `shopId` từ client. `parseProductInput` ném 400 kèm câu tiếng Việt
 * khi sai; trùng SKU trong shop → 409; thành công → 201 `{ product }`.
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

    const product = await createProduct(
      prisma,
      shop.id,
      parseProductInput(body),
    );

    return NextResponse.json({ product }, { status: 201 });
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
    console.error("POST /api/seller/products lỗi:", error);
    return NextResponse.json(
      { error: "Lỗi hệ thống, vui lòng thử lại" },
      { status: 500 },
    );
  }
}
