/**
 * Tên cookie chứa JWT phiên đăng nhập.
 *
 * Dùng chung cho HTTP (route handlers, middleware — Task 6) và socket
 * handshake (Task 10) nên chỉ định nghĩa một nơi, không viết lại chuỗi.
 */
export const COOKIE_NAME = "liveorder_token";

/** Phiên đăng nhập sống 7 ngày (giây) — khớp hạn `expiresIn: '7d'` của JWT (Task 5). */
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

/**
 * Options set cookie phiên — NGUỒN DUY NHẤT cho cả 4 route auth.
 *
 * Vì sao gom về đây thay vì viết tại từng route: cookie xoá lúc logout phải
 * trùng `path` với cookie lúc set, và các cờ bảo mật (httpOnly/sameSite/secure)
 * chỉ được đổi ở một chỗ — copy-paste sang nhiều file sẽ âm thầm lệch nhau.
 *
 * `secure` chỉ bật ở production: local dev chạy HTTP nên phải tắt, nếu không
 * trình duyệt sẽ bỏ qua cookie và không đăng nhập được.
 */
export function sessionCookieOptions(): {
  httpOnly: true;
  sameSite: "lax";
  path: "/";
  maxAge: number;
  secure: boolean;
} {
  return {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
    secure: process.env.NODE_ENV === "production",
  };
}
