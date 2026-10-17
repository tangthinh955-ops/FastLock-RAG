import { NextResponse } from "next/server";
import { COOKIE_NAME, sessionCookieOptions } from "@/lib/auth/constants";

/**
 * POST /api/auth/logout — xoá cookie phiên.
 * Set giá trị rỗng + `maxAge: 0` đúng `path: '/'` như lúc đăng nhập để trình
 * duyệt xoá hẳn; không cần đăng nhập trước cũng gọi được (idempotent).
 */
export async function POST() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set({
    name: COOKIE_NAME,
    value: "",
    // Xoá cookie: dùng CHUNG options với lúc set (nhất là `path`) rồi hết hạn ngay.
    ...sessionCookieOptions(),
    maxAge: 0,
  });
  return response;
}
