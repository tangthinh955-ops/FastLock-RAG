/**
 * Tên cookie chứa JWT phiên đăng nhập.
 *
 * Dùng chung cho HTTP (route handlers, middleware — Task 6) và socket
 * handshake (Task 10) nên chỉ định nghĩa một nơi, không viết lại chuỗi.
 */
export const COOKIE_NAME = "liveorder_token";
