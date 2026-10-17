import { Role } from "../../generated/prisma/client";
import { SEED_IDS } from "./ids";

/** Mật khẩu chung của mọi tài khoản demo (README ghi rõ email + mật khẩu). */
export const DEMO_PASSWORD = "demo123";

/** Số vòng băm bcrypt khi seed — 10 là mức thông dụng, đủ nhanh cho demo. */
export const BCRYPT_ROUNDS = 10;

export interface SeedUser {
  id: string;
  email: string;
  name: string;
  role: Role;
}

/** 3 khách (BUYER) + 2 chủ shop (SELLER) — mật khẩu chung `DEMO_PASSWORD`. */
export const SEED_USERS: readonly SeedUser[] = [
  { id: SEED_IDS.users.khach, email: "khach@demo.vn", name: "Khách", role: Role.BUYER },
  { id: SEED_IDS.users.hong, email: "hong@demo.vn", name: "Hồng", role: Role.BUYER },
  { id: SEED_IDS.users.minh, email: "minh@demo.vn", name: "Minh Tú", role: Role.BUYER },
  { id: SEED_IDS.users.linh, email: "linh@demo.vn", name: "Linh", role: Role.SELLER },
  { id: SEED_IDS.users.baoan, email: "baoan@demo.vn", name: "Bảo An", role: Role.SELLER },
];

export interface SeedShop {
  id: string;
  name: string;
  ownerId: string;
}

/** Shop chính của demo (Linh) + shop đối chứng chống lẫn shop (Bảo An). */
export const SEED_SHOPS: readonly SeedShop[] = [
  {
    id: SEED_IDS.shops.linh,
    name: "Shop Thời Trang Linh",
    ownerId: SEED_IDS.users.linh,
  },
  {
    id: SEED_IDS.shops.baoan,
    name: "Shop Áo Sơ Mi Bảo An",
    ownerId: SEED_IDS.users.baoan,
  },
];

export interface SeedProduct {
  id: string;
  shopId: string;
  sku: string;
  name: string;
  /** VND */
  price: number;
  stock: number;
}

/** Shop Thời Trang Linh — đúng bảng spec §9 (SKU/giá/kho, chữ y nguyên). */
export const SEED_PRODUCTS: readonly SeedProduct[] = [
  { id: SEED_IDS.products.linh_sp01, shopId: SEED_IDS.shops.linh, sku: "SP01", name: "Áo thun basic", price: 150_000, stock: 8 },
  { id: SEED_IDS.products.linh_sp02, shopId: SEED_IDS.shops.linh, sku: "SP02", name: "Quần jogger", price: 220_000, stock: 5 },
  { id: SEED_IDS.products.linh_sp03, shopId: SEED_IDS.shops.linh, sku: "SP03", name: "Nón bucket", price: 120_000, stock: 10 },
  { id: SEED_IDS.products.linh_sp04, shopId: SEED_IDS.shops.linh, sku: "SP04", name: "Quần short jean", price: 260_000, stock: 4 },
  { id: SEED_IDS.products.linh_sp05, shopId: SEED_IDS.shops.linh, sku: "SP05", name: "Áo polo", price: 150_000, stock: 6 },
  // SP06 kho 3 — để demo cháy hàng (spec §9).
  { id: SEED_IDS.products.linh_sp06, shopId: SEED_IDS.shops.linh, sku: "SP06", name: "Áo khoác gió", price: 320_000, stock: 3 },
  { id: SEED_IDS.products.linh_sp07, shopId: SEED_IDS.shops.linh, sku: "SP07", name: "Túi tote", price: 120_000, stock: 12 },

  // Shop Áo Sơ Mi Bảo An — SP01 trùng mã nhưng khác tên/giá/KB (chống lẫn shop).
  { id: SEED_IDS.products.baoan_sp01, shopId: SEED_IDS.shops.baoan, sku: "SP01", name: "Áo sơ mi công sở", price: 200_000, stock: 5 },
  { id: SEED_IDS.products.baoan_sp02, shopId: SEED_IDS.shops.baoan, sku: "SP02", name: "Quần âu công sở", price: 250_000, stock: 4 },
  { id: SEED_IDS.products.baoan_sp03, shopId: SEED_IDS.shops.baoan, sku: "SP03", name: "Thắt lưng da", price: 180_000, stock: 6 },
];

export interface SeedKbEntry {
  id: string;
  shopId: string;
  title: string;
  /** Nội dung dài, tiếng Việt tự nhiên — đây là nguồn RAG (embed title + answer). */
  answer: string;
}

/**
 * KB 1 — Shop Thời Trang Linh (6 chủ đề spec §9).
 * KB 2 — Shop Áo Sơ Mi Bảo An (3 chủ đề, điều khoản khác hẳn: đổi trả 3 ngày,
 * phí ship riêng, bảng size riêng) — dùng cho kịch bản "chống lẫn shop".
 */
export const SEED_KB_ENTRIES: readonly SeedKbEntry[] = [
  {
    id: SEED_IDS.kb.linh_size,
    shopId: SEED_IDS.shops.linh,
    title: "Bảng size — chọn size theo chiều cao & cân nặng",
    answer:
      "Bảng size tham khảo của Shop Thời Trang Linh:\n" +
      "- S: cao 1m50–1m58, nặng 42–50kg (vòng ngực 84–88cm)\n" +
      "- M: cao 1m58–1m65, nặng 51–58kg (vòng ngực 88–93cm)\n" +
      "- L: cao 1m65–1m72, nặng 59–68kg (vòng ngực 94–99cm)\n" +
      "- XL: cao 1m72–1m78, nặng 69–78kg (vòng ngực 100–106cm)\n" +
      "- XXL: trên 1m78, trên 78kg (vòng ngực trên 106cm)\n" +
      "Ví dụ bạn cao 1m68 nặng 62kg thì mặc size L là vừa nhất; nếu thích mặc rộng kiểu oversize thì lên XL. " +
      "Quần jogger và quần short jean nên chọn theo vòng bụng: 68–72cm → S, 73–78cm → M, 79–85cm → L, 86–92cm → XL. " +
      "Bạn cho shop chiều cao, cân nặng và số đo vòng ngực hoặc vòng bụng, shop tư vấn chính xác hơn nhé!",
  },
  {
    id: SEED_IDS.kb.linh_return,
    shopId: SEED_IDS.shops.linh,
    title: "Chính sách đổi trả 7 ngày",
    answer:
      "Shop Thời Trang Linh hỗ trợ đổi trả trong vòng 7 ngày kể từ khi bạn nhận hàng, với điều kiện sản phẩm còn tag, chưa qua sử dụng.\n" +
      "- Đổi vì chưa vừa size hoặc đổi mẫu: khách chịu phí ship hai chiều, shop đổi ngay khi nhận lại hàng.\n" +
      "- Hàng lỗi, giao sai mẫu hoặc sai size do shop: shop chịu toàn bộ phí ship hai chiều.\n" +
      "- Đổi sang sản phẩm khác giá cao hơn thì bạn bù chênh lệch, thấp hơn thì shop hoàn phần chênh qua chuyển khoản.\n" +
      "Khi cần đổi, bạn nhắn shop trong Inbox kèm mã đơn (dạng #số) và ảnh sản phẩm, shop gửi hướng dẫn gửi hàng về trong hôm đó.",
  },
  {
    id: SEED_IDS.kb.linh_defect,
    shopId: SEED_IDS.shops.linh,
    title: "Hàng lỗi & bảo hành",
    answer:
      "Với sản phẩm bị lỗi đường may, bung chỉ, gãy khóa kéo, phai màu bất thường hoặc in hình bong tróc, " +
      "bạn gửi ảnh cho shop trong vòng 48 giờ kể từ khi nhận hàng để được đổi mới hoàn toàn miễn phí (shop trả phí ship hai chiều). " +
      "Shop đổi đúng sản phẩm cùng loại cùng size; trường hợp hết hàng bạn được chọn mẫu khác tương đương hoặc shop hoàn tiền đầy đủ. " +
      "Lỗi do quá trình sử dụng như rách, ố bẩn, giặt sai cách không thuộc diện đổi mới, nhưng shop vẫn hỗ trợ sửa miễn phí nếu bạn gửi về. " +
      "Sản phẩm được bảo hành 30 ngày cho các lỗi kỹ thuật từ phía shop.",
  },
  {
    id: SEED_IDS.kb.linh_ship,
    shopId: SEED_IDS.shops.linh,
    title: "Vận chuyển & phí ship",
    answer:
      "Shop Thời Trang Linh gửi hàng qua các đơn vị giao vận tiêu chuẩn.\n" +
      "- Nội thành TP.HCM: nhận hàng trong 1 ngày.\n" +
      "- Các tỉnh, thành khác: 2–4 ngày làm việc.\n" +
      "- Phí ship theo biểu phí đơn vị vận chuyển, thường 25.000đ–40.000đ tuỳ khu vực, tính tại lúc chốt đơn.\n" +
      "- Ưu đãi: trong giờ live (20–22h hằng ngày), đơn từ 300.000đ được freeship toàn quốc. Ngoài giờ live, đơn từ 500.000đ shop vẫn freeship, còn lại tính phí bình thường.\n" +
      "Đơn có QR thanh toán: shop chỉ gửi hàng sau khi đơn được xác nhận thanh toán, bạn theo dõi trạng thái trong mục Đơn của tôi.",
  },
  {
    id: SEED_IDS.kb.linh_live_order,
    shopId: SEED_IDS.shops.linh,
    title: "Cách chốt đơn qua livestream",
    answer:
      "Khi shop lên sóng, bạn chốt đơn ngay trong phần bình luận của livestream theo cú pháp: MÃ SẢN PHẨM + SỐ LƯỢNG.\n" +
      "Ví dụ gõ 'SP01 2 cái' hoặc 'SP01 x2' là hệ thống tự nhận mã, kiểm tra kho, tạo đơn và trừ kho ngay. Mua 1 cái có thể chỉ gõ 'SP01'.\n" +
      "Bạn sẽ thấy dòng 'Đã tạo đơn #số' trong khung chat kèm thẻ Đơn của bạn ở góc màn hình; đơn mới ở trạng thái chờ thanh toán, bạn vào Đơn của tôi để quét QR và bấm giả lập chuyển khoản (bản demo).\n" +
      "Lưu ý: gõ đúng mã đang phát trong phiên live của đúng shop (SP01 của shop này khác shop khác), mỗi lần gõ một mã để tránh nhầm. Bình luận có số điện thoại sẽ được hệ thống che tự động để bảo vệ thông tin của bạn.",
  },
  {
    id: SEED_IDS.kb.linh_promo,
    shopId: SEED_IDS.shops.linh,
    title: "Khuyến mãi đang chạy (freeship trong giờ live)",
    answer:
      "Khuyến mãi hiện hành của Shop Thời Trang Linh:\n" +
      "- Freeship toàn quốc cho đơn từ 300.000đ tạo trong khung giờ live 20–22h hằng ngày.\n" +
      "- Ngoài khung giờ live: đơn từ 500.000đ vẫn được miễn phí vận chuyển, dưới mức đó thu phí theo biểu phí đơn vị vận chuyển.\n" +
      "- Khách quay lại mua lần thứ hai được giảm thêm 10% cho sản phẩm chính (áp dụng khi nhắn shop trong Inbox để xác nhận).\n" +
      "Mọi ưu đãi được áp dụng tự động khi đơn được tạo đúng điều kiện, không cần nhập mã. Shop không bán hàng giả, không thổi giá dịp live — giá hiển thị trong phiên live là giá bán cuối cùng.",
  },

  {
    id: SEED_IDS.kb.baoan_size,
    shopId: SEED_IDS.shops.baoan,
    title: "Bảng size áo sơ mi & quần âu",
    answer:
      "Bảng size riêng của Shop Áo Sơ Mi Bảo An (form công sở đứng, nếu thích mặc thoải mái hơn thì lên một size):\n" +
      "- S: cao 1m55–1m62, nặng 48–54kg, vòng ngực 88–92cm\n" +
      "- M: cao 1m62–1m68, nặng 55–62kg, vòng ngực 92–96cm\n" +
      "- L: cao 1m68–1m75, nặng 63–70kg, vòng ngực 96–101cm\n" +
      "- XL: cao 1m75–1m80, nặng 71–78kg, vòng ngực 101–106cm\n" +
      "- XXL: trên 1m80 hoặc trên 78kg\n" +
      "Quần âu lấy theo vòng bụng: 70–75cm → size 29-30, 76–81cm → 31-32, 82–88cm → 33-34. Áo sơ mi may theo cỡ cổ: cổ 38cm → S, 39-40cm → M, 41cm → L. Bạn gửi chiều cao, cân nặng và số đo cho shop, shop tư vấn đúng form công sở nhé.",
  },
  {
    id: SEED_IDS.kb.baoan_return,
    shopId: SEED_IDS.shops.baoan,
    title: "Đổi trả trong 3 ngày",
    answer:
      "Shop Áo Sơ Mi Bảo An chỉ nhận đổi trả trong vòng 3 ngày kể từ khi bạn nhận hàng (ngắn hơn mức thông thường, để kho kịp xử lý và xả hàng mới).\n" +
      "- Sản phẩm phải còn nguyên tag, chưa giặt, chưa qua sử dụng.\n" +
      "- Đổi size hoặc đổi mẫu: khách chịu phí ship hai chiều.\n" +
      "- Hàng lỗi hoặc giao sai do shop: shop chịu phí ship hai chiều và đổi mới ngay.\n" +
      "Quá thời hạn trên, shop chỉ hỗ trợ sửa chữa (nới cổ áo, lên lai) chứ không đổi trả. Vì vậy bạn vui lòng mở hàng kiểm tra ngay khi nhận và nhắn shop kèm mã đơn trong Inbox nếu cần đổi.",
  },
  {
    id: SEED_IDS.kb.baoan_ship,
    shopId: SEED_IDS.shops.baoan,
    title: "Phí ship & thời gian giao hàng",
    answer:
      "Shop Áo Sơ Mi Bảo An tính phí ship riêng theo từng khu vực, không có chương trình freeship kể cả trong giờ live:\n" +
      "- Nội thành Hà Nội: 1 ngày, phí 25.000đ.\n" +
      "- Các tỉnh thành khác: 2–4 ngày, phí 30.000đ–45.000đ tuỳ đơn vị vận chuyển.\n" +
      "- Mua từ 3 sản phẩm trở lên shop gộp chung một kiện hàng để tiết kiệm phí cho bạn.\n" +
      "Phí ship được cộng vào đơn khi shop xác nhận qua Inbox và bạn thanh toán cùng tiền hàng. Shop không miễn phí vận chuyển dưới mọi hình thức, bạn vui lòng kiểm tra kỹ trước khi chốt đơn nhé.",
  },
];
