import { NextResponse } from "next/server";
import { COOKIE_NAME, sessionCookieOptions } from "@/lib/auth/constants";
import { ApiError, registerUser } from "@/lib/auth/service";
import { signToken } from "@/lib/auth/token";
import { prisma } from "@/lib/db";

/**
 * POST /api/auth/register — tạo tài khoản BUYER, set cookie phiên 7 ngày.
 * Thành công trả thẳng TokenPayload; lỗi nghiệp vụ → `{ error }` + status.
 */
export async function POST(request: Request) {
  let body: { email?: unknown; password?: unknown; name?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Dữ liệu gửi lên không hợp lệ" },
      { status: 400 },
    );
  }

  try {
    const payload = await registerUser(prisma, {
      email: typeof body.email === "string" ? body.email : "",
      password: typeof body.password === "string" ? body.password : "",
      name: typeof body.name === "string" ? body.name : "",
    });

    const response = NextResponse.json(payload);
    // Cookie phiên dùng options chung của module auth (constants.ts).
    response.cookies.set({
      name: COOKIE_NAME,
      value: await signToken(payload),
      ...sessionCookieOptions(),
    });
    return response;
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    }
    console.error("POST /api/auth/register lỗi:", error);
    return NextResponse.json(
      { error: "Lỗi hệ thống, vui lòng thử lại" },
      { status: 500 },
    );
  }
}
