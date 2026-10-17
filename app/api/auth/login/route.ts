import { NextResponse } from "next/server";
import { COOKIE_NAME } from "@/lib/auth/constants";
import { ApiError, login } from "@/lib/auth/service";
import { signToken } from "@/lib/auth/token";
import { prisma } from "@/lib/db";

/**
 * POST /api/auth/login — kiểm tra email/mật khẩu, set cookie phiên 7 ngày.
 * Sai thông tin → 401 (thông báo chung, không lộ email nào đã đăng ký).
 */
export async function POST(request: Request) {
  let body: { email?: unknown; password?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Dữ liệu gửi lên không hợp lệ" },
      { status: 400 },
    );
  }

  try {
    const payload = await login(prisma, {
      email: typeof body.email === "string" ? body.email : "",
      password: typeof body.password === "string" ? body.password : "",
    });

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
    console.error("POST /api/auth/login lỗi:", error);
    return NextResponse.json(
      { error: "Lỗi hệ thống, vui lòng thử lại" },
      { status: 500 },
    );
  }
}
