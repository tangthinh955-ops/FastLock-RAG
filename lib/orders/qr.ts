import QRCode from "qrcode";

/**
 * QR giả lập thanh toán (Plan 3 Task 1 — spec §8.3). Toàn bộ sinh QR chạy LOCAL
 * (`qrcode`), không gọi ngân hàng/API nào; nội dung chỉ là văn bản demo nên
 * không app ngân hàng thật nào hiểu thành lệnh chuyển tiền.
 *
 * Module server-only: trang `/orders` (server component) gọi để lấy data URL.
 * KHÔNG import vào client component — bundle khách không cần thư viện QR.
 */

/** Thông tin "ngân hàng" demo — KHÔNG phải tài khoản thật. */
export type DemoBankInfo = { bankId: string; account: string; owner: string };

const DEFAULT_BANK_ID = "970436";
const DEFAULT_BANK_ACCOUNT = "0000000000";
const DEFAULT_OWNER = "LIVEORDER DEMO";

/** Đọc env mỗi lần gọi (test stub được); rỗng/toàn khoảng trắng → mặc định. */
function envOr(value: string | undefined, fallback: string): string {
  if (value === undefined || value.trim() === "") {
    return fallback;
  }
  return value;
}

export function demoBankInfo(): DemoBankInfo {
  return {
    bankId: envOr(process.env.DEMO_BANK_ID, DEFAULT_BANK_ID),
    account: envOr(process.env.DEMO_BANK_ACCOUNT, DEFAULT_BANK_ACCOUNT),
    owner: envOr(process.env.DEMO_BANK_OWNER, DEFAULT_OWNER),
  };
}

/**
 * Nội dung QR nhiều dòng — người xem đọc được bằng app quét bất kỳ, thấy rõ đây
 * là bản demo: mã thanh toán, mã đơn và số tiền của ĐÚNG đơn đang mở.
 */
export function paymentQrContent(order: {
  paymentCode: string;
  code: number;
  total: number;
}): string {
  const bank = demoBankInfo();
  return [
    "LIVEORDER-DEMO",
    `BANK: ${bank.bankId}`,
    `ACCOUNT: ${bank.account}`,
    `OWNER: ${bank.owner}`,
    `CODE: ${order.paymentCode}`,
    `ORDER: #${order.code}`,
    `AMOUNT: ${order.total}đ`,
  ].join("\n");
}

/** PNG data URL (240px) — nhúng thẳng vào `<img>` của trang server component. */
export async function renderQrDataUrl(content: string): Promise<string> {
  return QRCode.toDataURL(content, { width: 240, margin: 1 });
}
