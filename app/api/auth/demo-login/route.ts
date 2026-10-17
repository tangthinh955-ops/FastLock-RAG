import { NextResponse } from "next/server";
import { COOKIE_NAME } from "@/lib/auth/constants";
import { ApiError, demoLogin, type DemoLoginAs } from "@/lib/auth/service";
import { signToken } from "@/lib/auth/token";
import { prisma } from "@/lib/db";

/** Ba đích hợp lệ — validate trước khi vào service để `as` là kiểu chặt. */
const DEMO_TARGETS: readonly DemoLoginAs[] = ["buyer", "seller1", "seller2"];

/**
 * POST /api/auth/demo-login — nút đăng nhập nhanh cho buổi demo.
 * Chỉ hoạt động khi `DEMO_MODE === 'true'` (service kiểm tra, ngược lại 404).
 */
export async function POST(request: Request) {
  let body: { as?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Dữ liệu gửi lên không hợp lệ" },
      { status: 400 },
    );
  }

  const as = body.as;
  if (!DEMO_TARGETS.includes(as as DemoLoginAs)) {
    return NextResponse.json(
      { error: "Tham số 'as' không hợp lệ" },
      { status: 400 },
    );
  }

  try {
    const payload = await demoLogin(prisma, as as DemoLoginAs);

    const response = NextResponse.json(payload);
    response.cookies.set({
      name: COOKIE_NAME,
      value: await signToken(payload),
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 7,
      secure: process.env.NODE_ENV === "production",
    });
    return response;
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    }
    console.error("POST /api/auth/demo-login lỗi:", error);
    return NextResponse.json(
      { error: "Lỗi hệ thống, vui lòng thử lại" },
      { status: 500 },
    );
  }
}
