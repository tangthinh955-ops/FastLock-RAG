import { Prisma } from "../../generated/prisma/client";
import type {
  DirectMessage,
  PrismaClient,
} from "../../generated/prisma/client";
import { ApiError } from "../auth/service";
import { appendMessage, getOrCreateConversation } from "../chat/service";

/**
 * Service đơn hàng phía khách (Plan 3 Task 1 — spec §5.4 "Đơn của tôi", §8.3 QR):
 * danh sách/chi tiết đơn của ĐÚNG buyer và đường DUY NHẤT để đơn chuyển PAID
 * trong chế độ demo.
 *
 * Cùng pattern `ChatPrisma`/`LiveServicePrisma`: hàm nhận `prisma` (app singleton
 * hoặc `testPrisma`), ném `ApiError`, không đụng socket — route handler phát
 * `emitInboxMessage` sau khi service trả về, nhờ vậy test chạy offline.
 */

/** Cùng pattern `ChatPrisma`: instance app singleton hoặc testPrisma. */
export type OrdersPrisma = PrismaClient;

/** Đơn kèm đủ quan hệ để trang `/orders` render chi tiết không query thêm. */
export type OrderWithRefs = Prisma.OrderGetPayload<{
  include: { product: true; shop: true };
}>;

/** "240000" → "240.000" — tách nghìn bằng dấu chấm, không phụ thuộc locale/ICU. */
function formatVnd(value: number): string {
  return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/** Đơn của đúng buyer, mới nhất trước (`code` autoincrement ⇒ desc = mới nhất). */
export async function listBuyerOrders(
  prisma: OrdersPrisma,
  buyerId: string,
): Promise<OrderWithRefs[]> {
  return prisma.order.findMany({
    where: { buyerId },
    orderBy: { code: "desc" },
    include: { product: true, shop: true },
  });
}

/**
 * Một đơn của đúng buyer; `null` khi đơn không tồn tại HOẶC không thuộc buyer —
 * một câu trả lời duy nhất để caller không phân biệt được (không lộ đơn người
 * khác có tồn tại hay không).
 */
export async function getBuyerOrder(
  prisma: OrdersPrisma,
  buyerId: string,
  orderId: string,
): Promise<OrderWithRefs | null> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { product: true, shop: true },
  });
  if (order === null || order.buyerId !== buyerId) {
    return null;
  }
  return order;
}

/** Nội dung tin SYSTEM khi đơn được trả tiền — chỉ số liệu thật của đơn. */
function paidContent(order: {
  code: number;
  qty: number;
  total: number;
  product: { name: string };
}): string {
  return (
    `✅ Đã nhận thanh toán đơn #${order.code} — ${order.product.name} ×${order.qty} — ` +
    `${formatVnd(order.total)}đ. Shop sẽ chuẩn bị hàng ngay!`
  );
}

/**
 * Đường DUY NHẤT để PAID (demo): `updateMany` lọc id + buyerId + status PENDING
 * trong MỘT transaction — người khác gọi hay gọi lần hai đều `count = 0` ⇒ 409,
 * dữ liệu không đổi. Danh tính buyer luôn do caller lấy từ JWT, không tin payload.
 *
 * Sau khi commit mới tạo hội thoại + tin SYSTEM (`dedupKey order:{id}:paid`,
 * unique mức DB ⇒ gọi lại không nhân tin; `message = null`). Phần ghi tin bọc
 * try/catch: PAID đã commit thì lỗi ghi tin hiếm hoi không được biến route thành
 * 500 — log rồi vẫn trả đơn.
 */
export async function markOrderPaid(
  prisma: OrdersPrisma,
  input: { orderId: string; buyerId: string },
): Promise<{ order: OrderWithRefs; message: DirectMessage | null }> {
  const order = await prisma.$transaction(async (tx) => {
    const result = await tx.order.updateMany({
      where: {
        id: input.orderId,
        buyerId: input.buyerId,
        status: "PENDING",
      },
      data: { status: "PAID", paidAt: new Date() },
    });
    if (result.count === 0) {
      // Không tồn tại / không thuộc buyer / đã PAID — cùng một câu, không lộ.
      throw new ApiError(409, "Đơn không còn ở trạng thái chờ thanh toán");
    }
    const updated = await tx.order.findUnique({
      where: { id: input.orderId },
      include: { product: true, shop: true },
    });
    if (updated === null) {
      throw new ApiError(409, "Đơn không còn ở trạng thái chờ thanh toán");
    }
    return updated;
  });

  let message: DirectMessage | null = null;
  try {
    const conversation = await getOrCreateConversation(
      prisma,
      input.buyerId,
      order.shopId,
    );
    message = await appendMessage(prisma, {
      conversationId: conversation.id,
      source: "SYSTEM",
      content: paidContent(order),
      dedupKey: `order:${order.id}:paid`,
      orderId: order.id,
    });
  } catch (error: unknown) {
    // PAID đã commit: tin có thể thiếu trong tình huống DB lỗi hiếm, nhưng
    // không được làm hỏng phản hồi thanh toán.
    console.error("[orders] Lỗi tạo tin SYSTEM xác nhận thanh toán:", error);
  }

  return { order, message };
}
