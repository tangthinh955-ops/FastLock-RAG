import { unstable_rethrow } from "next/navigation";
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
    // R17 (ruling của controller, Task 11): `cookies()` bên trong `requireUser`
    // là Request-time API — lỗi bail-out lúc prerender của Next phải để Next xử
    // lý, không được nuốt thành 500/console.error (docs Next 16
    // `unstable_rethrow`). Trước bản vá này `npm run build` log lỗi giả tại đây.
    unstable_rethrow(error);
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
