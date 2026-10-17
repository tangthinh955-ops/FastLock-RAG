import { NextResponse } from "next/server";
import { COOKIE_NAME } from "@/lib/auth/constants";

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
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return response;
}
