import { Prisma } from "../../generated/prisma/client";
import type {
  Conversation,
  DirectMessage,
  MessageSource,
  PrismaClient,
} from "../../generated/prisma/client";
import { ApiError } from "../auth/service";

/**
 * Service hội thoại Inbox (Task 6 — spec §6 schema, §7.4 takeover, §8.5 tra đơn):
 * bền vững hoá tin nhắn, takeover + version, danh sách hội thoại và lịch sử tin.
 * Hàm thuần nhận `prisma` (caller truyền app singleton hoặc `testPrisma`) — cùng
 * đường code với socket gateway Task 7, không đụng socket/AI ở đây.
 *
 * Bất biến takeover (spec §7.4): seller gõ tay ⇒ `mode = HUMAN`, `version + 1` và
 * tin SELLER trong CÙNG một transaction; flow AI (Task 7) đọc lại `mode/version`
 * trước khi lưu để hủy im lặng khi lệch. "Trả lại cho AI" cũng `version + 1`
 * trong một transaction.
 *
 * KHÔNG che SĐT ở Inbox: che SĐT (spec §7.2) chỉ áp cho kênh CÔNG KHAI của
 * livestream (comment broadcast ra viewer); hội thoại 1–1 buyer ↔ shop là kênh
 * riêng nên giữ nguyên nội dung.
 */

/** Cùng pattern `LiveServicePrisma`/`AuthPrisma`: instance app singleton hoặc testPrisma. */
export type ChatPrisma = PrismaClient;

/** Một dòng danh sách hội thoại: hội thoại + đầu bên kia + tin cuối (nếu có). */
export type ConversationListItem = {
  conversation: Conversation;
  shop?: { id: string; name: string };
  buyer?: { id: string; name: string };
  lastMessage: DirectMessage | null;
};

/** Số tin mặc định khi caller không yêu cầu `take` — đủ cho khung chat demo. */
const DEFAULT_MESSAGE_TAKE = 50;

/**
 * Lấy hội thoại buyer ↔ shop, tạo mới nếu chưa có. Idempotent nhờ unique
 * `[buyerId, shopId]`: pre-check cho đường thường (một query), còn đua hiếm —
 * hai request cùng thấy "chưa có" — thì kẻ thua `create` nhận P2002 rồi đọc lại
 * dòng thắng, nên mọi lời gọi đều trả cùng một hội thoại, DB không nhân dòng.
 */
export async function getOrCreateConversation(
  prisma: ChatPrisma,
  buyerId: string,
  shopId: string,
): Promise<Conversation> {
  const existing = await prisma.conversation.findUnique({
    where: { buyerId_shopId: { buyerId, shopId } },
  });
  if (existing !== null) {
    return existing;
  }

  try {
    return await prisma.conversation.create({ data: { buyerId, shopId } });
  } catch (error) {
    // Chỉ nuốt P2002 của unique [buyerId, shopId]: đọc lại đúng cặp khóa, thấy
    // dòng thắng thì trả nó; không thấy (P2002 của ràng buộc khác) → ném tiếp.
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      const raced = await prisma.conversation.findUnique({
        where: { buyerId_shopId: { buyerId, shopId } },
      });
      if (raced !== null) {
        return raced;
      }
    }
    throw error;
  }
}

/**
 * Ghi một tin vào hội thoại. `dedupKey` (khi có) là khóa chống trùng mức DB —
 * cùng nonce gửi lại chỉ lưu một tin (spec §7.6; dây A dùng `order:{id}:remind`).
 * Trả `null` khi va chạm `dedupKey` để caller bỏ qua im lặng.
 *
 * P2002 ở Prisma 7 + driver adapter không kèm `meta.target` ổn định, nên xác
 * nhận đúng va chạm bằng dòng có `dedupKey` đó (chỉ nuốt đúng ca này); lỗi khác —
 * kể cả P2002 không thuộc dedupKey — ném tiếp, không hoá thành null im lặng.
 */
export async function appendMessage(
  prisma: ChatPrisma,
  input: {
    conversationId: string;
    source: MessageSource;
    content: string;
    dedupKey?: string;
    orderId?: string;
    trace?: Prisma.InputJsonValue;
  },
): Promise<DirectMessage | null> {
  try {
    return await prisma.directMessage.create({
      data: {
        conversationId: input.conversationId,
        source: input.source,
        content: input.content,
        dedupKey: input.dedupKey,
        orderId: input.orderId,
        trace: input.trace,
      },
    });
  } catch (error) {
    if (
      input.dedupKey !== undefined &&
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      const existing = await prisma.directMessage.findUnique({
        where: { dedupKey: input.dedupKey },
      });
      if (existing !== null) {
        return null;
      }
    }
    throw error;
  }
}

/**
 * Nạp hội thoại và chặn seller ngoài shop — thiếu hội thoại trả CÙNG 403 để
 * không lộ hội thoại nào tồn tại cho người không có quyền.
 */
async function requireSellerConversation(
  tx: Prisma.TransactionClient,
  conversationId: string,
  sellerShopId: string,
): Promise<Conversation> {
  const conversation = await tx.conversation.findUnique({
    where: { id: conversationId },
  });
  if (conversation === null || conversation.shopId !== sellerShopId) {
    throw new ApiError(403, "Hội thoại không thuộc shop của bạn.");
  }
  return conversation;
}

/**
 * Seller gõ tay ⇒ takeover: `mode = HUMAN`, `version + 1` và tin SELLER trong
 * MỘT transaction (spec §7.4) — sai shop thì ném trước, transaction không ghi gì.
 * Trả hội thoại với `mode/version` MỚI để flow phát `conversation_updated`.
 */
export async function sellerSendMessage(
  prisma: ChatPrisma,
  input: { conversationId: string; sellerShopId: string; content: string },
): Promise<{ message: DirectMessage; conversation: Conversation }> {
  return prisma.$transaction(async (tx) => {
    await requireSellerConversation(tx, input.conversationId, input.sellerShopId);

    const conversation = await tx.conversation.update({
      where: { id: input.conversationId },
      data: { mode: "HUMAN", version: { increment: 1 } },
    });
    const message = await tx.directMessage.create({
      data: {
        conversationId: input.conversationId,
        source: "SELLER",
        content: input.content,
      },
    });
    return { message, conversation };
  });
}

/**
 * "Trả lại cho AI" (spec §7.4): `mode = AI`, `version + 1` — cùng guard shop và
 * cùng transaction như takeover. Không tạo tin nào: AI tư vấn lại từ tin kế tiếp.
 */
export async function handBackToAi(
  prisma: ChatPrisma,
  input: { conversationId: string; sellerShopId: string },
): Promise<Conversation> {
  return prisma.$transaction(async (tx) => {
    await requireSellerConversation(tx, input.conversationId, input.sellerShopId);
    return tx.conversation.update({
      where: { id: input.conversationId },
      data: { mode: "AI", version: { increment: 1 } },
    });
  });
}

/**
 * Mốc "hoạt động gần nhất" của một dòng danh sách: tin cuối nếu có, ngược lại
 * `updatedAt` (takeover/trả-AI cập nhật hội thoại mà không tạo tin). `updatedAt`
 * một mình không đủ vì tin mới KHÔNG tự đụng hội thoại — nếu chỉ sắp theo
 * `updatedAt`, hội thoại vừa có tin mới sẽ nằm sai chỗ so với `lastMessage`.
 */
function activityAt(item: ConversationListItem): number {
  const lastMessageAt = item.lastMessage?.createdAt.getTime() ?? 0;
  return Math.max(item.conversation.updatedAt.getTime(), lastMessageAt);
}

/** Sắp giảm dần theo hoạt động; hoà thì `updatedAt` mới hơn đứng trước. */
function sortByActivity(items: ConversationListItem[]): ConversationListItem[] {
  return items.sort(
    (a, b) =>
      activityAt(b) - activityAt(a) ||
      b.conversation.updatedAt.getTime() - a.conversation.updatedAt.getTime(),
  );
}

/**
 * Danh sách hội thoại của buyer (spec §5.3, Task 9): kèm `shop {id,name}` và tin
 * cuối mỗi hội thoại — một query với include `take: 1` rồi map, không N+1.
 */
export async function listBuyerConversations(
  prisma: ChatPrisma,
  buyerId: string,
): Promise<ConversationListItem[]> {
  const rows = await prisma.conversation.findMany({
    where: { buyerId },
    orderBy: { updatedAt: "desc" },
    include: {
      shop: { select: { id: true, name: true } },
      messages: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });

  return sortByActivity(
    rows.map((row) => {
      const { messages, shop, ...conversation } = row;
      return { conversation, shop, lastMessage: messages[0] ?? null };
    }),
  );
}

/**
 * Danh sách hội thoại của shop (spec §5.10, Task 10): kèm `buyer {id,name}` và
 * tin cuối. `Conversation` chỉ giữ `buyerId` (không có quan hệ tới `User`) nên
 * đọc tên buyer bằng một `findMany` theo tập id — hai query, không N+1.
 */
export async function listShopConversations(
  prisma: ChatPrisma,
  shopId: string,
): Promise<ConversationListItem[]> {
  const rows = await prisma.conversation.findMany({
    where: { shopId },
    orderBy: { updatedAt: "desc" },
    include: { messages: { orderBy: { createdAt: "desc" }, take: 1 } },
  });

  const buyerIds = [...new Set(rows.map((row) => row.buyerId))];
  const buyers = await prisma.user.findMany({
    where: { id: { in: buyerIds } },
    select: { id: true, name: true },
  });
  const buyerById = new Map(buyers.map((buyer) => [buyer.id, buyer]));

  return sortByActivity(
    rows.map((row) => {
      const { messages, ...conversation } = row;
      return {
        conversation,
        buyer: buyerById.get(row.buyerId),
        lastMessage: messages[0] ?? null,
      };
    }),
  );
}

/**
 * Lịch sử tin của hội thoại, LUÔN tăng dần theo thời gian (UI chat đọc từ trên
 * xuống). Mặc định 50 tin gần nhất; `take` N thì lấy N tin MỚI NHẤT (fetch
 * giảm dần rồi đảo) — không phải N tin đầu tiên. Fixture test ghim `createdAt`
 * tách biệt; tin cùng một mili-giây không có thứ tự cam kết giữa chúng.
 */
export async function getMessages(
  prisma: ChatPrisma,
  conversationId: string,
  opts: { take?: number } = {},
): Promise<DirectMessage[]> {
  const newest = await prisma.directMessage.findMany({
    where: { conversationId },
    orderBy: { createdAt: "desc" },
    take: opts.take ?? DEFAULT_MESSAGE_TAKE,
  });
  return newest.reverse();
}
