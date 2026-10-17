import { cookies } from "next/headers";
import { COOKIE_NAME } from "./constants";
import { ApiError } from "./service";
import { verifyToken, type TokenPayload } from "./token";

/**
 * Logic chính của guard, tách khỏi `next/headers` để unit test gọi trực tiếp
 * (test không cần mock request context):
 * - thiếu token → 401
 * - token sai/hết hạn → 401
 * - lệch role → 403
 * - hợp lệ → TokenPayload
 */
export async function requireUserWithToken(
  token: string | undefined,
  role?: "BUYER" | "SELLER",
): Promise<TokenPayload> {
  if (!token) {
    throw new ApiError(401, "Bạn cần đăng nhập để tiếp tục");
  }

  const user = await verifyToken(token);
  if (!user) {
    throw new ApiError(401, "Phiên đăng nhập không hợp lệ hoặc đã hết hạn");
  }

  if (role && user.role !== role) {
    throw new ApiError(403, "Bạn không có quyền truy cập chức năng này");
  }

  return user;
}

/**
 * Wrapper mỏng dùng trong route handlers: đọc cookie phiên rồi giao toàn bộ
 * quyết định cho `requireUserWithToken`.
 *
 * Lưu ý: proxy/middleware KHÔNG dùng hàm này — nó verify token từ request của
 * chính proxy; đây là guard cho các route handler chạy trong app.
 */
export async function requireUser(
  role?: "BUYER" | "SELLER",
): Promise<TokenPayload> {
  const cookieStore = await cookies();
  return requireUserWithToken(cookieStore.get(COOKIE_NAME)?.value, role);
}
