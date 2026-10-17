import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { COOKIE_NAME } from "@/lib/auth/constants";
import { verifyToken } from "@/lib/auth/token";

/**
 * Proxy — tên mới của middleware kể từ Next 16 (`middleware.ts` đã bị
 * deprecate, xem node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md).
 * Chạy trước khi render để chặn sớm các trang riêng tư:
 * - `/seller/*` chỉ SELLER
 * - `/inbox/*`, `/orders/*` chỉ cần đăng nhập
 * Không đủ điều kiện → chuyển hướng `/login`.
 *
 * Verify JWT bằng jose ngay tại đây (optimistic check) — KHÔNG import Prisma
 * hay bcryptjs; lớp bảo vệ thật vẫn là guard trong từng route handler.
 */
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const token = request.cookies.get(COOKIE_NAME)?.value;
  const user = token ? await verifyToken(token) : null;

  const needsSellerRole =
    pathname === "/seller" || pathname.startsWith("/seller/");
  const allowed = user !== null && (!needsSellerRole || user.role === "SELLER");

  if (!allowed) {
    return NextResponse.redirect(new URL("/login", request.url), 302);
  }

  return NextResponse.next();
}

/**
 * Chỉ chạy proxy trên 3 tiền tố cần bảo vệ — trang công khai, API và asset
 * không bị ảnh hưởng.
 */
export const config = {
  matcher: ["/seller/:path*", "/inbox/:path*", "/orders/:path*"],
};
