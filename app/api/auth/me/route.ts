import { NextResponse } from "next/server";
import { ApiError } from "@/lib/auth/service";
import { requireUser } from "@/lib/auth/guards";

/**
 * GET /api/auth/me — danh tính của phiên hiện tại (đọc cookie httpOnly).
 * Chưa đăng nhập hoặc token hỏng → 401; trả thẳng TokenPayload khi hợp lệ.
 */
export async function GET() {
  try {
    return NextResponse.json(await requireUser());
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    }
    console.error("GET /api/auth/me lỗi:", error);
    return NextResponse.json(
      { error: "Lỗi hệ thống, vui lòng thử lại" },
      { status: 500 },
    );
  }
}
