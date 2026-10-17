import { createHash, randomInt, randomUUID } from "node:crypto";
import {
  OrderStatus,
  Prisma,
  PrismaClient,
} from "../../generated/prisma/client";
import {
  buildAutomaton,
  findMatchesWithTiming,
  type Automaton,
  type Match,
} from "../aho-corasick";
import { maskPhones } from "../mask";

/**
 * Pipeline comment livestream → bắt SKU → tạo đơn + trừ kho (spec §6 ràng buộc
 * "trừ kho atomic", §7.6 chống trùng `eventId`) — lõi tính năng ①.
 *
 * Thứ tự xử lý cố định:
 * 1. Tra phiên live: không tồn tại / không `LIVE` → `NO_LIVE_SESSION`; text
 *    trắng → `EMPTY_TEXT` (phiên được kiểm trước nội dung — xem chú thích test).
 * 2. `maskPhones(rawText)` rồi mới parse: `start/end` của match phải trỏ đúng
 *    chuỗi phát đi cho client (Task 10/14 cắt highlight từ chính `text` này).
 * 3. Chỉ xử lý match ĐẦU TIÊN — mỗi comment chốt một mã, đúng kịch bản demo.
 * 4. Số lượng nằm trong 20 ký tự SAU mã: số đứng riêng 1–2 chữ số đầu tiên;
 *    số trước mã (size, số nhà…) không phải số chốt mua.
 * 5. `eventId = sha1(phiên | user | nonce | sku)`: cùng nonce gửi lại ⇒ tra ra
 *    đúng đơn cũ và trả `duplicate: true` — chống double-click/mạng lag.
 * 6. Trừ kho bằng `updateMany` có điều kiện `stock >= qty` TRONG cùng transaction
 *    với `create Order`: hai khách cùng chốt khi kho còn 1 → đúng một người
 *    thắng (`count = 1`, tạo đơn), người thua nhận `outOfStockSku` (`count = 0`,
 *    kho nguyên vẹn, transaction không ghi gì) — kho không bao giờ âm.
 *
 * Quyết định đã chốt (để Task 10/11 không phải đoán):
 * - Vai trò `BUYER`/`SELLER` KHÔNG đổi đường xử lý: spec §5/§6 không có luật
 *   "seller không được tạo đơn", và UI Studio không có ô gửi comment nên seller
 *   không vô tình tự chốt đơn. Thêm nhánh riêng cho seller sẽ đẻ ra một trạng
 *   thái im lặng (không đơn, không lý do) mà hợp đồng kết quả không khai báo.
 * - Mã khớp nhưng không (còn) là sản phẩm của shop phiên này → `ok: true` kèm
 *   `matches` nhưng KHÔNG tạo đơn và KHÔNG phải hết hàng (`outOfStockSku` chỉ
 *   dành cho sản phẩm thật sự hết kho). Trường hợp này xảy ra khi chỉ mục SKU
 *   theo phiên còn giữ mã của sản phẩm đã bị xoá giữa live.
 */

/**
 * Client Prisma dạng instance — cùng pattern `SeedPrisma`/`AuthPrisma`: nhận cả
 * app singleton (`lib/db.ts`) lẫn `testPrisma` (integration test).
 */
export type LiveServicePrisma = InstanceType<typeof PrismaClient>;

/** Đơn rút gọn để phát socket/toast — đủ cho UI, không lộ chi tiết DB. */
export type OrderSummary = {
  id: string;
  code: number;
  sku: string;
  productName: string;
  qty: number;
  total: number;
  status: OrderStatus;
};

/** `user` là `TokenPayload` (Task 5) — khớp thẳng `socket.data.user` của Task 10. */
export type ProcessCommentInput = {
  sessionId: string;
  user: { userId: string; name: string; role: "BUYER" | "SELLER" };
  rawText: string;
  clientNonce?: string;
};

export type ProcessCommentResult =
  | {
      ok: true;
      text: string;
      matches: Match[];
      elapsedMs: number;
      order?: OrderSummary;
      duplicate?: true;
      outOfStockSku?: string;
    }
  | { ok: false; reason: "NO_LIVE_SESSION" | "EMPTY_TEXT" };

/** Cửa sổ tìm số lượng tính từ ký tự đầu tiên SAU mã bắt được. */
const QTY_WINDOW_CHARS = 20;

/**
 * "Số đứng riêng" 1–2 chữ số: không dính vào dãy số dài hơn ở cả hai phía —
 * nên "SP01 12" → 12, còn phần số nằm trong SĐT đã che (0912***678) không bị
 * cắt nham nhở thành số lượng.
 */
const QTY_PATTERN = /(?<!\d)(\d{1,2})(?!\d)/;

const QTY_MIN = 1;
const QTY_MAX = 99;

/** Mã thanh toán: `PAY` + 8 ký tự base36 (0–9a–z) — in lên QR của đơn PENDING. */
const PAYMENT_CODE_PREFIX = "PAY";
const PAYMENT_CODE_LENGTH = 8;
const BASE36_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";

/**
 * Chỉ mục SKU giữ theo PHIÊN live (Task 8 chốt automaton bất biến, dùng chung
 * an toàn). Dựng một lần rồi tái dùng cho mọi comment của phiên — thay vì dựng
 * lại trie mỗi comment. Sản phẩm thay đổi giữa live chỉ làm chỉ mục cũ đi; nhánh
 * "mã không còn thuộc shop" bên dưới xử lý sạch trường hợp đó, và phiên ENDED
 * thì bị xoá khỏi cache ngay khi có comment chạm tới.
 */
const sessionAutomata = new Map<string, Automaton>();

function randomBase36(length: number): string {
  let code = "";
  for (let i = 0; i < length; i += 1) {
    code += BASE36_ALPHABET[randomInt(BASE36_ALPHABET.length)];
  }
  return code;
}

function paymentCode(): string {
  return PAYMENT_CODE_PREFIX + randomBase36(PAYMENT_CODE_LENGTH);
}

/** Phần Order cần cho `OrderSummary` — Order kèm sản phẩm (sku/tên). */
type OrderRow = {
  id: string;
  code: number;
  qty: number;
  total: number;
  status: OrderStatus;
  product: { sku: string; name: string };
};

function toOrderSummary(order: OrderRow): OrderSummary {
  return {
    id: order.id,
    code: order.code,
    sku: order.product.sku,
    productName: order.product.name,
    qty: order.qty,
    total: order.total,
    status: order.status,
  };
}

/**
 * Số lượng trong `QTY_WINDOW_CHARS` ký tự sau mã. Cắt cửa sổ theo chỉ số UTF-16
 * của match trên chính chuỗi đã che — cùng hệ tọa độ với highlight của UI.
 */
function parseQuantity(text: string, matchEnd: number): number {
  const window = text.slice(matchEnd, matchEnd + QTY_WINDOW_CHARS);
  const found = QTY_PATTERN.exec(window);
  if (found === null) {
    return QTY_MIN;
  }
  return Math.min(Math.max(Number(found[1]), QTY_MIN), QTY_MAX);
}

async function getSessionAutomaton(
  prisma: LiveServicePrisma,
  sessionId: string,
  shopId: string,
): Promise<Automaton> {
  const cached = sessionAutomata.get(sessionId);
  if (cached !== undefined) {
    return cached;
  }

  const products = await prisma.product.findMany({
    where: { shopId },
    select: { sku: true },
    orderBy: { sku: "asc" },
  });
  const automaton = buildAutomaton(products.map((product) => product.sku));
  sessionAutomata.set(sessionId, automaton);
  return automaton;
}

function findOrderByEventId(
  prisma: LiveServicePrisma,
  eventId: string,
): Promise<OrderRow | null> {
  return prisma.order.findUnique({
    where: { eventId },
    include: { product: true },
  });
}

/**
 * Xử lý một comment livestream trọn vẹn: che SĐT → bắt SKU → (tuỳ chọn) tạo
 * đơn + trừ kho nguyên tử. Hàm thuần nhận `prisma` nên test chạy đúng đường code
 * của socket gateway (Task 10) mà không cần dựng server.
 */
export async function processComment(
  prisma: LiveServicePrisma,
  input: ProcessCommentInput,
): Promise<ProcessCommentResult> {
  const session = await prisma.liveSession.findUnique({
    where: { id: input.sessionId },
  });
  if (!session || session.status !== "LIVE") {
    sessionAutomata.delete(input.sessionId);
    return { ok: false, reason: "NO_LIVE_SESSION" };
  }

  if (input.rawText.trim() === "") {
    return { ok: false, reason: "EMPTY_TEXT" };
  }
  const text = maskPhones(input.rawText);

  const automaton = await getSessionAutomaton(
    prisma,
    session.id,
    session.shopId,
  );
  const { matches, elapsedMs } = findMatchesWithTiming(automaton, text);

  const firstMatch = matches[0];
  if (firstMatch === undefined) {
    return { ok: true, text, matches, elapsedMs };
  }

  const sku = firstMatch.sku;
  const qty = parseQuantity(text, firstMatch.end);
  const nonce = input.clientNonce ?? randomUUID();
  const eventId = createHash("sha1")
    .update(`${input.sessionId}|${input.user.userId}|${nonce}|${sku}`)
    .digest("hex");

  // Pre-check nhanh: chỉ có thể trùng khi client gửi kèm nonce (nonce thiếu thì
  // eventId chứa UUID ngẫu nhiên nên chắc chắn chưa tồn tại — khỏi tốn query).
  if (input.clientNonce !== undefined) {
    const existing = await findOrderByEventId(prisma, eventId);
    if (existing) {
      return {
        ok: true,
        text,
        matches,
        elapsedMs,
        order: toOrderSummary(existing),
        duplicate: true,
      };
    }
  }

  // Tra sản phẩm theo (shop của PHIÊN, sku) — chống lẫn shop: mã SP01 của shop
  // khác là bản ghi khác (giá/kho riêng), không bao giờ dùng thay thế.
  const product = await prisma.product.findUnique({
    where: { shopId_sku: { shopId: session.shopId, sku } },
  });
  if (!product) {
    return { ok: true, text, matches, elapsedMs };
  }

  let created: OrderRow | null;
  try {
    created = await prisma.$transaction(async (tx) => {
      // Chỉ trừ kho khi còn đủ hàng: điều kiện `stock >= qty` nằm ngay trong
      // câu UPDATE nên hai transaction song song cùng thấy "còn 1" vẫn không
      // thể cùng trừ — PostgreSQL hàng đợi row lock rồi đánh giá lại điều kiện.
      const decremented = await tx.product.updateMany({
        where: { id: product.id, stock: { gte: qty } },
        data: { stock: { decrement: qty } },
      });
      if (decremented.count === 0) {
        return null;
      }

      return tx.order.create({
        data: {
          shopId: session.shopId,
          buyerId: input.user.userId,
          productId: product.id,
          qty,
          unitPrice: product.price,
          total: product.price * qty,
          status: OrderStatus.PENDING,
          eventId,
          paymentCode: paymentCode(),
          liveSessionId: session.id,
        },
        include: { product: true },
      });
    });
  } catch (error) {
    // Hai request cùng nonce chạy song song có thể cùng lọt pre-check: request
    // thua bị unique `eventId` chặn (P2002) → transaction rollback (kho đã trừ
    // cũng hoàn) → trả đơn của request thắng với `duplicate: true`. P2002 khác
    // (ví dụ trùng `paymentCode` — xác suất cực nhỏ) không nuốt: ném tiếp lỗi thật.
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      const existing = await findOrderByEventId(prisma, eventId);
      if (existing) {
        return {
          ok: true,
          text,
          matches,
          elapsedMs,
          order: toOrderSummary(existing),
          duplicate: true,
        };
      }
    }
    throw error;
  }

  if (created === null) {
    // Hết hàng: không đơn, kho nguyên (transaction không ghi gì).
    return { ok: true, text, matches, elapsedMs, outOfStockSku: sku };
  }

  return {
    ok: true,
    text,
    matches,
    elapsedMs,
    order: toOrderSummary(created),
  };
}
