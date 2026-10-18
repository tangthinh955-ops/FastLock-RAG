/**
 * Chữ cái đại diện của shop để làm avatar chữ: lấy từ đầu, riêng tiền tố "Shop"
 * (không phân biệt hoa thường) bị bỏ qua và lấy từ cuối — "Shop Thời Trang Linh"
 * → "L", "Shop Áo Sơ Mi Bảo An" → "A"; tên rỗng → "?".
 *
 * Dùng chung cho `ShopCard` (trang chủ) và `ViewerClient` (trang xem live):
 * trước đây hai file copy y nguyên hàm này, review cuối Plan 1 gom về một chỗ.
 */
export function shopInitial(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const first = words[0];
  if (first === undefined) {
    return "?";
  }
  const word =
    first.toLocaleLowerCase("vi") === "shop"
      ? words[words.length - 1]
      : first;
  return word.charAt(0).toLocaleUpperCase("vi") || "?";
}
