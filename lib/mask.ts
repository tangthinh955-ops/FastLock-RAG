/**
 * Ứng viên SĐT di động VN: đầu số `0x` (x ∈ 3/5/7/8/9) với 9 chữ số còn lại,
 * hoặc `+84`/`84` với 9 chữ số. Dấu cách/chấm/gạch được phép nằm giữa bất kỳ
 * chữ số nào vì người gõ tự do ("0912 345 678", "091 234 5678", "03 1234 5678",
 * "0912.345.678", "+84 912 345 678") — chuẩn hóa rồi mới kiểm tra.
 *
 * Ranh giới số `(?<!\d)` … `(?!\d)`: dãy số nằm trong chuỗi chữ số dài hơn
 * (mã vận đơn 15 chữ số, số 11 chữ số…) không bị cắt nham nhở ở giữa.
 */
const MOBILE_PHONE_REGEX =
  /(?<!\d)(?:\+?84|0)[\s.-]*[35789](?:[\s.-]*\d){8}(?!\d)/g;

/**
 * Che một span đã khớp: chuẩn hóa về dạng `0xxxxxxxxx` (bỏ dấu cách/chấm/gạch,
 * quy `+84` → `0`) rồi giữ 4 số đầu + `***` + 3 số cuối.
 *
 * Che theo dạng chuẩn hóa để bản phát đi không giữ lại cấu trúc nhóm số của
 * bản gốc đã gõ (kể cả `+84` cũng về dạng `0` thống nhất).
 */
function maskMatch(matched: string): string {
  const normalized = matched.replace(/[\s.-]+/g, "").replace(/^\+?84/, "0");
  return `${normalized.slice(0, 4)}***${normalized.slice(-3)}`;
}

/**
 * Che mọi SĐT di động VN trong `text` trước khi broadcast lên kênh công khai
 * (spec §7.2 — che SERVER-SIDE, không tin client). Hàm thuần, không phụ thuộc
 * môi trường nên test được độc lập.
 */
export function maskPhones(text: string): string {
  return text.replace(MOBILE_PHONE_REGEX, maskMatch);
}
