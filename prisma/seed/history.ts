import {
  ChatMode,
  LiveStatus,
  MessageSource,
  OrderStatus,
} from "../../generated/prisma/client";
import type { AiTrace } from "../../lib/chat/trace";
import type { SeedPrisma } from "./base";
import { SEED_IDS } from "./ids";

/**
 * Seed lịch sử (Task 4) — "nền" dữ liệu cho Dashboard (Plan 3) và badge
 * "hội thoại trong đêm" của Inbox (Plan 2):
 * - 5 hội thoại khách↔shop, tin nhắn rải 7–30 ngày trước; 3 hội thoại có AI
 *   trả lời trong khung 22h–6h (khách hỏi 23:10, AI trả lời 00:12).
 * - 2 phiên live đã ENDED của shop Linh (hôm qua, 7 ngày trước).
 * - 5 đơn cũ của shop Linh rải giữa 3 khách (bảng cố định trong plan).
 *
 * Mọi bản ghi upsert theo id cố định trong `SEED_IDS.history` nên chạy lại
 * không nhân đôi. Đơn lịch sử KHÔNG trừ kho: kho spec §9 là trạng thái hiện
 * tại khi demo bắt đầu.
 */

/** ms trong 1 phút — hội thoại mở trước tin nhắn đầu 1 phút. */
const ONE_MINUTE_MS = 60_000;

/**
 * Mốc "cách đây `days` ngày, đúng `hours:minutes` giờ máy".
 *
 * Thời gian seed tính từ hôm nay nhưng ghim giờ cụ thể (phiên live
 * 20:00–22:05, nhóm đêm 23:10 / 00:12) để test và demo ổn định ở mọi ngày.
 */
function daysAgo(days: number, hours: number, minutes: number): Date {
  const date = new Date();
  date.setDate(date.getDate() - days);
  date.setHours(hours, minutes, 0, 0);
  return date;
}

/**
 * Trace mẫu cho tin AI lịch sử (Plan 3 T5): đúng model demo, topK trỏ id/title
 * THẬT của KB seed, products đúng SKU/giá/kho seed §9 — để khối "Hiệu quả AI"
 * của Dashboard có thời gian trả lời ngay khi mở, và chip nguồn ở Inbox không
 * trỏ vào dữ liệu hư cấu.
 */
type SeedKbRef = { id: string; title: string };
type SeedProductRef = SeedKbRef & {
  sku: string;
  price: number;
  stock: number;
};

const LINH_KB = {
  size: {
    id: SEED_IDS.kb.linh_size,
    title: "Bảng size — chọn size theo chiều cao & cân nặng",
  },
  return: {
    id: SEED_IDS.kb.linh_return,
    title: "Chính sách đổi trả 7 ngày",
  },
  defect: {
    id: SEED_IDS.kb.linh_defect,
    title: "Hàng lỗi & bảo hành",
  },
  ship: {
    id: SEED_IDS.kb.linh_ship,
    title: "Vận chuyển & phí ship",
  },
  liveOrder: {
    id: SEED_IDS.kb.linh_live_order,
    title: "Cách chốt đơn qua livestream",
  },
  promo: {
    id: SEED_IDS.kb.linh_promo,
    title: "Khuyến mãi đang chạy (freeship trong giờ live)",
  },
} satisfies Record<string, SeedKbRef>;

const BAOAN_KB = {
  size: {
    id: SEED_IDS.kb.baoan_size,
    title: "Bảng size áo sơ mi & quần âu",
  },
  return: {
    id: SEED_IDS.kb.baoan_return,
    title: "Đổi trả trong 3 ngày",
  },
  ship: {
    id: SEED_IDS.kb.baoan_ship,
    title: "Phí ship & thời gian giao hàng",
  },
} satisfies Record<string, SeedKbRef>;

const LINH_PRODUCTS = {
  sp01: {
    id: SEED_IDS.products.linh_sp01,
    sku: "SP01",
    title: "Áo thun basic",
    price: 150_000,
    stock: 8,
  },
  sp02: {
    id: SEED_IDS.products.linh_sp02,
    sku: "SP02",
    title: "Quần jogger",
    price: 220_000,
    stock: 5,
  },
  sp04: {
    id: SEED_IDS.products.linh_sp04,
    sku: "SP04",
    title: "Quần short jean",
    price: 260_000,
    stock: 4,
  },
  sp05: {
    id: SEED_IDS.products.linh_sp05,
    sku: "SP05",
    title: "Áo polo",
    price: 150_000,
    stock: 6,
  },
} satisfies Record<string, SeedProductRef>;

const BAOAN_PRODUCTS = {
  sp01: {
    id: SEED_IDS.products.baoan_sp01,
    sku: "SP01",
    title: "Áo sơ mi công sở",
    price: 200_000,
    stock: 5,
  },
  sp02: {
    id: SEED_IDS.products.baoan_sp02,
    sku: "SP02",
    title: "Quần âu công sở",
    price: 250_000,
    stock: 4,
  },
} satisfies Record<string, SeedProductRef>;

function kbHit(ref: SeedKbRef, score: number): AiTrace["topK"][number] {
  return { id: ref.id, title: ref.title, kind: "kb", score };
}

function productHit(
  ref: SeedProductRef,
  score: number,
): AiTrace["topK"][number] {
  return {
    id: ref.id,
    title: ref.title,
    kind: "product",
    sku: ref.sku,
    score,
  };
}

function productRow(
  ref: SeedProductRef,
): AiTrace["products"][number] {
  return {
    sku: ref.sku,
    name: ref.title,
    price: ref.price,
    stock: ref.stock,
  };
}

function aiTrace(input: {
  topK: AiTrace["topK"];
  products: AiTrace["products"];
  prompt: number;
  completion: number;
  elapsedMs: number;
}): AiTrace {
  return {
    model: "qwen/qwen3.8-27b",
    topK: input.topK,
    products: input.products,
    tokens: { prompt: input.prompt, completion: input.completion },
    elapsedMs: input.elapsedMs,
  };
}

export interface SeedHistoryMessage {
  id: string;
  source: MessageSource;
  content: string;
  createdAt: Date;
  /** Truy vết RAG của tin AI (Plan 3 T5) — tin người gửi không có field này. */
  trace?: AiTrace;
}

export interface SeedHistoryConversation {
  id: string;
  buyerId: string;
  shopId: string;
  /** AI xử lý hay seller đã tiếp quản (Hồng↔Linh kết thúc bằng tin seller). */
  mode: ChatMode;
  version: number;
  /** Theo thứ tự thời gian; tin cuối quyết định `updatedAt` của hội thoại. */
  messages: readonly SeedHistoryMessage[];
}

/**
 * 5 hội thoại cố định — nội dung tự nhiên quanh chủ đề mua sắm (size, đổi trả,
 * tra đơn, phí ship) làm nền hội thoại cho Plan 2.
 */
export const SEED_HISTORY_CONVERSATIONS: readonly SeedHistoryConversation[] = [
  {
    // Khách hỏi size lúc 23:10, AI trả lời 00:12 — đúng "nhóm đêm" của plan.
    id: SEED_IDS.history.conversations.khach_linh,
    buyerId: SEED_IDS.users.khach,
    shopId: SEED_IDS.shops.linh,
    mode: ChatMode.AI,
    version: 1,
    messages: [
      {
        id: SEED_IDS.history.messages.khach_linh_1,
        source: MessageSource.BUYER,
        content:
          "Shop ơi mình cao 1m68 nặng 62kg, mặc áo thun basic size gì vừa ạ?",
        createdAt: daysAgo(9, 23, 10),
      },
      {
        id: SEED_IDS.history.messages.khach_linh_2,
        source: MessageSource.AI,
        content:
          "Chào bạn! Với chiều cao 1m68, cân nặng 62kg thì bạn mặc size L là vừa nhất ạ: " +
          "áo thun basic size L form chuẩn, quần jogger size L vừa vòng bụng 79–85cm. " +
          "Nếu bạn thích mặc rộng kiểu oversize thì lên XL nhé. Bạn cần shop tư vấn thêm màu nào không ạ?",
        createdAt: daysAgo(8, 0, 12),
        trace: aiTrace({
          topK: [
            kbHit(LINH_KB.size, 0.94),
            productHit(LINH_PRODUCTS.sp01, 0.82),
            productHit(LINH_PRODUCTS.sp02, 0.78),
            kbHit(LINH_KB.return, 0.61),
          ],
          products: [productRow(LINH_PRODUCTS.sp01), productRow(LINH_PRODUCTS.sp02)],
          prompt: 428,
          completion: 176,
          elapsedMs: 2100,
        }),
      },
      {
        id: SEED_IDS.history.messages.khach_linh_3,
        source: MessageSource.BUYER,
        content: "Cảm ơn shop, vậy mình lấy áo thun size L màu trắng nha.",
        createdAt: daysAgo(8, 0, 25),
      },
      {
        id: SEED_IDS.history.messages.khach_linh_4,
        source: MessageSource.AI,
        content:
          "Dạ vâng ạ. Bạn vào phiên live 20–22h tối nay, gõ SP01 1 cái trong phần bình luận " +
          "là hệ thống tạo đơn ngay cho bạn nhé. Đơn từ 300.000đ tạo trong giờ live còn được freeship toàn quốc nữa ạ!",
        createdAt: daysAgo(8, 0, 38),
        trace: aiTrace({
          topK: [
            kbHit(LINH_KB.promo, 0.91),
            kbHit(LINH_KB.liveOrder, 0.86),
            kbHit(LINH_KB.ship, 0.7),
          ],
          products: [productRow(LINH_PRODUCTS.sp01)],
          prompt: 386,
          completion: 142,
          elapsedMs: 1700,
        }),
      },
    ],
  },
  {
    // Hội thoại ban ngày; seller tiếp quản ở tin cuối → mode HUMAN, version 2.
    id: SEED_IDS.history.conversations.hong_linh,
    buyerId: SEED_IDS.users.hong,
    shopId: SEED_IDS.shops.linh,
    mode: ChatMode.HUMAN,
    version: 2,
    messages: [
      {
        id: SEED_IDS.history.messages.hong_linh_1,
        source: MessageSource.BUYER,
        content:
          "Shop ơi, mình nhận áo polo size M mà mặc hơi chật, đổi sang size L được không ạ?",
        createdAt: daysAgo(15, 15, 20),
      },
      {
        id: SEED_IDS.history.messages.hong_linh_2,
        source: MessageSource.AI,
        content:
          "Dạ được nhé! Shop hỗ trợ đổi trả trong 7 ngày kể từ khi bạn nhận hàng, sản phẩm còn nguyên tag " +
          "và chưa qua sử dụng. Trường hợp chưa vừa size, bạn chịu phí ship hai chiều giúp shop ạ. " +
          "Bạn gửi ảnh sản phẩm vào hội thoại này để shop kiểm tra nhé.",
        createdAt: daysAgo(15, 15, 21),
        trace: aiTrace({
          topK: [kbHit(LINH_KB.return, 0.93), kbHit(LINH_KB.defect, 0.55)],
          products: [productRow(LINH_PRODUCTS.sp05)],
          prompt: 364,
          completion: 154,
          elapsedMs: 1900,
        }),
      },
      {
        id: SEED_IDS.history.messages.hong_linh_3,
        source: MessageSource.BUYER,
        content: "Mình vừa gửi ảnh đó shop, hàng vẫn còn tag nguyên nha.",
        createdAt: daysAgo(15, 16, 2),
      },
      {
        id: SEED_IDS.history.messages.hong_linh_4,
        source: MessageSource.SELLER,
        content:
          "Shop đã nhận ảnh và ghi nhận đổi sang size L cho bạn nha. Bạn gói hàng gửi lại theo hướng dẫn, " +
          "kho nhận được là shop gửi size L trong ngày luôn ạ.",
        createdAt: daysAgo(15, 16, 40),
      },
    ],
  },
  {
    // Khách hỏi tra đơn ngay sau live tối (23:10), AI trả lời sau nửa đêm.
    id: SEED_IDS.history.conversations.minh_linh,
    buyerId: SEED_IDS.users.minh,
    shopId: SEED_IDS.shops.linh,
    mode: ChatMode.AI,
    version: 1,
    messages: [
      {
        id: SEED_IDS.history.messages.minh_linh_1,
        source: MessageSource.BUYER,
        content:
          "Shop ơi đơn mình vừa chốt trong live tối nay bao giờ được gửi vậy ạ?",
        createdAt: daysAgo(21, 23, 10),
      },
      {
        id: SEED_IDS.history.messages.minh_linh_2,
        source: MessageSource.AI,
        content:
          "Dạ đơn của bạn đang ở trạng thái chờ thanh toán. Bạn vào mục Đơn của tôi, quét QR rồi bấm xác nhận " +
          "chuyển khoản; shop gửi hàng trong ngày sau khi đơn được thanh toán nhé. " +
          "Đơn tạo trong giờ live 20–22h từ 300.000đ còn được freeship toàn quốc nữa ạ.",
        createdAt: daysAgo(20, 0, 12),
        trace: aiTrace({
          topK: [
            kbHit(LINH_KB.liveOrder, 0.88),
            kbHit(LINH_KB.promo, 0.72),
          ],
          products: [productRow(LINH_PRODUCTS.sp01)],
          prompt: 412,
          completion: 168,
          elapsedMs: 2400,
        }),
      },
      {
        id: SEED_IDS.history.messages.minh_linh_3,
        source: MessageSource.BUYER,
        content: "Mình quét QR xong bấm xác nhận là được đúng không shop?",
        createdAt: daysAgo(20, 0, 30),
      },
      {
        id: SEED_IDS.history.messages.minh_linh_4,
        source: MessageSource.AI,
        content:
          "Dạ đúng ạ. Sau khi bạn xác nhận, hệ thống ghi nhận Đã thanh toán và shop chuẩn bị gửi hàng ngay. " +
          "Bạn theo dõi trạng thái ở mục Đơn của tôi nhé. Cần gì thêm bạn cứ nhắn shop trong hội thoại này ạ.",
        createdAt: daysAgo(20, 0, 34),
        trace: aiTrace({
          topK: [kbHit(LINH_KB.liveOrder, 0.84), kbHit(LINH_KB.ship, 0.66)],
          products: [productRow(LINH_PRODUCTS.sp01)],
          prompt: 302,
          completion: 112,
          elapsedMs: 1500,
        }),
      },
    ],
  },
  {
    // Chống lẫn shop: SP01 của Bảo An là Áo sơ mi công sở 200.000đ, đổi trả 3 ngày.
    id: SEED_IDS.history.conversations.khach_baoan,
    buyerId: SEED_IDS.users.khach,
    shopId: SEED_IDS.shops.baoan,
    mode: ChatMode.AI,
    version: 1,
    messages: [
      {
        id: SEED_IDS.history.messages.khach_baoan_1,
        source: MessageSource.BUYER,
        content: "Shop ơi SP01 của shop giá bao nhiêu ạ?",
        createdAt: daysAgo(23, 23, 10),
      },
      {
        id: SEED_IDS.history.messages.khach_baoan_2,
        source: MessageSource.AI,
        content:
          "Dạ, SP01 bên mình là Áo sơ mi công sở, giá 200.000đ ạ. Shop Áo Sơ Mi Bảo An đổi trả trong vòng 3 ngày " +
          "kể từ khi nhận hàng, bạn kiểm tra hàng ngay khi nhận giúp shop nhé.",
        createdAt: daysAgo(22, 0, 12),
        trace: aiTrace({
          topK: [
            kbHit(BAOAN_KB.return, 0.87),
            productHit(BAOAN_PRODUCTS.sp01, 0.83),
            kbHit(BAOAN_KB.size, 0.53),
          ],
          products: [productRow(BAOAN_PRODUCTS.sp01)],
          prompt: 342,
          completion: 128,
          elapsedMs: 1600,
        }),
      },
      {
        id: SEED_IDS.history.messages.khach_baoan_3,
        source: MessageSource.BUYER,
        content: "Mình cao 1m70 nặng 65kg thì mặc size nào vừa shop?",
        createdAt: daysAgo(22, 0, 30),
      },
      {
        id: SEED_IDS.history.messages.khach_baoan_4,
        source: MessageSource.AI,
        content:
          "Với chiều cao 1m70, cân nặng 65kg, bạn chọn size L là vừa form công sở ạ. " +
          "Nếu thích mặc thoải mái hơn thì lên XL nhé. Phí ship nội thành Hà Nội 25.000đ, " +
          "bạn ở khu vực nào để shop báo phí chính xác ạ?",
        createdAt: daysAgo(22, 0, 41),
        trace: aiTrace({
          topK: [kbHit(BAOAN_KB.size, 0.92), kbHit(BAOAN_KB.ship, 0.7)],
          products: [productRow(BAOAN_PRODUCTS.sp01), productRow(BAOAN_PRODUCTS.sp02)],
          prompt: 388,
          completion: 164,
          elapsedMs: 2200,
        }),
      },
    ],
  },
  {
    // Bảo An không freeship (đối chứng điều khoản khác Linh).
    id: SEED_IDS.history.conversations.hong_baoan,
    buyerId: SEED_IDS.users.hong,
    shopId: SEED_IDS.shops.baoan,
    mode: ChatMode.AI,
    version: 1,
    messages: [
      {
        id: SEED_IDS.history.messages.hong_baoan_1,
        source: MessageSource.BUYER,
        content: "Shop ơi bên mình có freeship không ạ?",
        createdAt: daysAgo(27, 14, 5),
      },
      {
        id: SEED_IDS.history.messages.hong_baoan_2,
        source: MessageSource.AI,
        content:
          "Dạ shop không có chương trình freeship kể cả trong giờ live ạ. Phí ship nội thành Hà Nội là 25.000đ, " +
          "các tỉnh khác 30.000đ–45.000đ tuỳ đơn vị vận chuyển. Bạn mua từ 3 sản phẩm trở lên " +
          "shop gộp chung một kiện hàng để tiết kiệm phí nhé.",
        createdAt: daysAgo(27, 14, 6),
        trace: aiTrace({
          topK: [kbHit(BAOAN_KB.ship, 0.95), kbHit(BAOAN_KB.return, 0.6)],
          products: [productRow(BAOAN_PRODUCTS.sp01)],
          prompt: 334,
          completion: 124,
          elapsedMs: 1800,
        }),
      },
      {
        id: SEED_IDS.history.messages.hong_baoan_3,
        source: MessageSource.BUYER,
        content: "Ok shop, mình lấy 2 áo sơ mi trắng size M gửi về Hà Nội nhé.",
        createdAt: daysAgo(27, 14, 20),
      },
      {
        id: SEED_IDS.history.messages.hong_baoan_4,
        source: MessageSource.AI,
        content:
          "Dạ shop ghi nhận 2 áo sơ mi công sở size M giao Hà Nội: tiền hàng 400.000đ cộng phí ship 25.000đ " +
          "là 425.000đ ạ. Hai áo shop gộp một kiện và gửi trong ngày cho bạn nhé!",
        createdAt: daysAgo(27, 14, 21),
        trace: aiTrace({
          topK: [kbHit(BAOAN_KB.ship, 0.9), kbHit(BAOAN_KB.size, 0.62)],
          products: [productRow(BAOAN_PRODUCTS.sp01), productRow(BAOAN_PRODUCTS.sp02)],
          prompt: 366,
          completion: 146,
          elapsedMs: 2300,
        }),
      },
    ],
  },
];

export interface SeedHistorySession {
  id: string;
  title: string;
  startedAt: Date;
  endedAt: Date;
  peakViewers: number;
}

/** 2 phiên live cũ của shop Linh — đều ENDED, khung 20:00–22:05. */
export const SEED_HISTORY_SESSIONS: readonly SeedHistorySession[] = [
  {
    id: SEED_IDS.history.sessions.linh_yesterday,
    title: "Live tối qua — áo thun basic và quần jogger",
    startedAt: daysAgo(1, 20, 0),
    endedAt: daysAgo(1, 22, 5),
    peakViewers: 47,
  },
  {
    id: SEED_IDS.history.sessions.linh_week_ago,
    title: "Live 7 ngày trước — áo khoác gió và quần short jean",
    startedAt: daysAgo(7, 20, 0),
    endedAt: daysAgo(7, 22, 5),
    peakViewers: 63,
  },
];

export interface SeedHistoryOrder {
  id: string;
  buyerId: string;
  productId: string;
  qty: number;
  /** VND — giá spec §9; `total` = qty × unitPrice khi seed. */
  unitPrice: number;
  status: OrderStatus;
  eventId: string;
  paymentCode: string;
  paidAt: Date | null;
  liveSessionId: string;
  createdAt: Date;
}

/**
 * Bảng đơn lịch sử cố định của shop Linh (plan Task 4) — tổng đã thu tiền
 * 300.000 + 440.000 + 260.000 + 960.000 = 1.960.000đ.
 */
export const SEED_HISTORY_ORDERS: readonly SeedHistoryOrder[] = [
  {
    id: SEED_IDS.history.orders.h1,
    buyerId: SEED_IDS.users.khach,
    productId: SEED_IDS.products.linh_sp01,
    qty: 2,
    unitPrice: 150_000,
    status: OrderStatus.PAID,
    eventId: "seed-h1",
    paymentCode: "SEEDH1",
    paidAt: daysAgo(1, 20, 15),
    liveSessionId: SEED_IDS.history.sessions.linh_yesterday,
    createdAt: daysAgo(1, 20, 12),
  },
  {
    id: SEED_IDS.history.orders.h2,
    buyerId: SEED_IDS.users.hong,
    productId: SEED_IDS.products.linh_sp02,
    qty: 2,
    unitPrice: 220_000,
    status: OrderStatus.PAID,
    eventId: "seed-h2",
    paymentCode: "SEEDH2",
    paidAt: daysAgo(1, 20, 43),
    liveSessionId: SEED_IDS.history.sessions.linh_yesterday,
    createdAt: daysAgo(1, 20, 41),
  },
  {
    // Đơn bị huỷ: không có paidAt (chưa thu tiền).
    id: SEED_IDS.history.orders.h3,
    buyerId: SEED_IDS.users.minh,
    productId: SEED_IDS.products.linh_sp03,
    qty: 1,
    unitPrice: 120_000,
    status: OrderStatus.CANCELLED,
    eventId: "seed-h3",
    paymentCode: "SEEDH3",
    paidAt: null,
    liveSessionId: SEED_IDS.history.sessions.linh_yesterday,
    createdAt: daysAgo(1, 21, 5),
  },
  {
    id: SEED_IDS.history.orders.h4,
    buyerId: SEED_IDS.users.khach,
    productId: SEED_IDS.products.linh_sp04,
    qty: 1,
    unitPrice: 260_000,
    status: OrderStatus.SHIPPED,
    eventId: "seed-h4",
    paymentCode: "SEEDH4",
    paidAt: daysAgo(7, 20, 33),
    liveSessionId: SEED_IDS.history.sessions.linh_week_ago,
    createdAt: daysAgo(7, 20, 30),
  },
  {
    id: SEED_IDS.history.orders.h5,
    buyerId: SEED_IDS.users.hong,
    productId: SEED_IDS.products.linh_sp06,
    qty: 3,
    unitPrice: 320_000,
    status: OrderStatus.PAID,
    eventId: "seed-h5",
    paymentCode: "SEEDH5",
    paidAt: daysAgo(7, 21, 15),
    liveSessionId: SEED_IDS.history.sessions.linh_week_ago,
    createdAt: daysAgo(7, 21, 12),
  },
];

/**
 * Upsert toàn bộ lịch sử seed (hội thoại + tin nhắn + phiên live cũ + đơn cũ)
 * theo id cố định → chạy lại bao nhiêu lần cũng không nhân đôi.
 *
 * Gọi SAU `seedBase` (đơn cần product/shop/user đã tồn tại). KHÔNG trừ kho:
 * kho spec §9 là trạng thái hiện tại khi demo bắt đầu.
 */
export async function seedHistory(prisma: SeedPrisma): Promise<void> {
  await prisma.$transaction(async (tx) => {
    for (const conversation of SEED_HISTORY_CONVERSATIONS) {
      const firstMessage = conversation.messages[0];
      const lastMessage = conversation.messages[conversation.messages.length - 1];

      const conversationFields = {
        buyerId: conversation.buyerId,
        shopId: conversation.shopId,
        mode: conversation.mode,
        version: conversation.version,
        createdAt: new Date(firstMessage.createdAt.getTime() - ONE_MINUTE_MS),
        // @updatedAt sẽ bị kéo về "bây giờ" mỗi lần re-seed nếu không set tay;
        // ghim theo tin cuối để thứ tự Inbox/dashboard luôn ổn định.
        updatedAt: lastMessage.createdAt,
      };

      await tx.conversation.upsert({
        where: { id: conversation.id },
        update: conversationFields,
        create: { id: conversation.id, ...conversationFields },
      });

      for (const message of conversation.messages) {
        const messageFields = {
          source: message.source,
          content: message.content,
          createdAt: message.createdAt,
          // `undefined` với tin BUYER/SELLER/SYSTEM — Prisma bỏ qua field này.
          trace: message.trace,
        };

        await tx.directMessage.upsert({
          where: { id: message.id },
          update: messageFields,
          create: {
            id: message.id,
            conversationId: conversation.id,
            ...messageFields,
          },
        });
      }
    }

    for (const session of SEED_HISTORY_SESSIONS) {
      const sessionFields = {
        // Cả 2 phiên lịch sử đều thuộc shop Linh (bảng cố định của plan).
        shopId: SEED_IDS.shops.linh,
        title: session.title,
        status: LiveStatus.ENDED,
        startedAt: session.startedAt,
        endedAt: session.endedAt,
        peakViewers: session.peakViewers,
      };

      await tx.liveSession.upsert({
        where: { id: session.id },
        update: sessionFields,
        create: { id: session.id, ...sessionFields },
      });
    }

    for (const order of SEED_HISTORY_ORDERS) {
      const orderFields = {
        // Cả 5 đơn lịch sử đều thuộc shop Linh (bảng cố định của plan).
        shopId: SEED_IDS.shops.linh,
        buyerId: order.buyerId,
        productId: order.productId,
        qty: order.qty,
        unitPrice: order.unitPrice,
        total: order.qty * order.unitPrice,
        status: order.status,
        eventId: order.eventId,
        paymentCode: order.paymentCode,
        paidAt: order.paidAt,
        liveSessionId: order.liveSessionId,
        createdAt: order.createdAt,
      };

      await tx.order.upsert({
        where: { id: order.id },
        update: orderFields,
        create: { id: order.id, ...orderFields },
      });
    }
  });
}
