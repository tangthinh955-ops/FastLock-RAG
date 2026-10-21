import type { Namespace, Server, Socket } from "socket.io";
import type { PrismaClient } from "../../generated/prisma/client";
import { ApiError } from "../auth/service";
import { verifyToken, type TokenPayload } from "../auth/token";
import {
  conversationRoom,
  INBOX_NAMESPACE,
  shopInboxRoom,
} from "../socket-registry";
import { createAiRunner, type AiRunner } from "./ai";
import {
  handleBuyerMessage,
  handleHandBackToAi,
  handleSellerMessage,
  type InboxAiThinkingEvent,
  type InboxConversationEvent,
  type InboxErrorEvent,
  type InboxMessageEvent,
} from "./flow";

// Vốn từ sự kiện nằm ở flow (nơi sinh payload); gateway tái xuất để UI Task 8
// chỉ cần import một chỗ từ `lib/chat/gateway`.
export type {
  InboxAiThinkingEvent,
  InboxConversationEvent,
  InboxErrorEvent,
  InboxMessageEvent,
} from "./flow";

/**
 * Gateway socket.io namespace `/inbox` (Task 7) — lớp plumbing mỏng: handshake
 * JWT, validate payload, kiểm quyền phòng, rồi giao nghiệp vụ cho flow
 * (`handleBuyerMessage`/`handleSellerMessage`/`handleHandBackToAi`).
 *
 * Bất biến bảo mật (giống `/live`):
 * - **Danh tính CHỈ từ JWT**: handshake `auth.token` → `verifyToken` →
 *   `socket.data.user`; mọi field `userId`/`role`/`buyerId` trong payload sự
 *   kiện bị bỏ qua hoàn toàn (không đọc tới).
 * - SELLER phải sở hữu shop (tra `shop` theo `ownerId`); không có shop → từ chối
 *   ngay ở handshake. Seller connect xong tự vào `shop:{shopId}`.
 * - Sai quyền hội thoại (buyer không phải chủ / seller không phải shop chủ) →
 *   `inbox_error` CHỈ cho socket đó, không phát vào phòng, không lộ hội thoại có
 *   tồn tại hay không (một thông báo duy nhất cho mọi ca bị chặn).
 *
 * Phát sự kiện (message/conversation_updated/ai_thinking) là việc của flow qua
 * `createInboxEmitter`; gateway chỉ phát `inbox_error` tại chỗ. `deps.aiRunner`
 * cho test tiêm runner giả (race takeover cần runner "treo" điều khiển được).
 */

/** Giới hạn độ dài tin nhắn Inbox (Task 8 chặn ở client, gateway chặn lại). */
const MAX_MESSAGE_LENGTH = 2000;

const NO_ACCESS_MESSAGE =
  "Hội thoại không tồn tại hoặc không thuộc quyền truy cập của bạn.";
const INVALID_PAYLOAD_MESSAGE = "Yêu cầu không hợp lệ";
const INVALID_CONTENT_MESSAGE = "Tin nhắn không hợp lệ";
const SELLER_ONLY_MESSAGE = "Chỉ người bán mới trả hội thoại về cho AI được.";
const SYSTEM_ERROR_MESSAGE = "Lỗi hệ thống, vui lòng thử lại.";

export type InboxServerToClientEvents = {
  message: (event: InboxMessageEvent) => void;
  conversation_updated: (event: InboxConversationEvent) => void;
  ai_thinking: (event: InboxAiThinkingEvent) => void;
  inbox_error: (event: InboxErrorEvent) => void;
};

/**
 * Payload client→server là `unknown` có chủ đích: client gửi gì cũng được,
 * gateway tự validate — không tạo cảm giác an toàn giả bằng type.
 */
export type InboxClientToServerEvents = {
  join_conversation: (payload: unknown) => void;
  send_message: (payload: unknown) => void;
  hand_back_to_ai: (payload: unknown) => void;
};

export type InboxInterServerEvents = Record<string, never>;

/** `shopId` chỉ có với SELLER (đã xác thực ở handshake) — buyer để trống. */
export type InboxSocketData = { user: TokenPayload; shopId?: string };

export type InboxSocket = Socket<
  InboxClientToServerEvents,
  InboxServerToClientEvents,
  InboxInterServerEvents,
  InboxSocketData
>;

/** Payload dạng object? Trả record để đọc field, ngược lại `null`. */
function asRecord(payload: unknown): Record<string, unknown> | null {
  return typeof payload === "object" && payload !== null
    ? (payload as Record<string, unknown>)
    : null;
}

/** `conversationId` hợp lệ (chuỗi khác rỗng)? Ngược lại `null`. */
function parseConversationId(payload: Record<string, unknown> | null): string | null {
  const conversationId = payload?.conversationId;
  return typeof conversationId === "string" && conversationId !== ""
    ? conversationId
    : null;
}

/** Nội dung tin: trim 1..2000 ký tự, ngược lại `null` (không lưu gì). */
function parseContent(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const content = value.trim();
  return content === "" || content.length > MAX_MESSAGE_LENGTH ? null : content;
}

/** Độ dài tối đa của `clientNonce` — dài hơn bị coi như không có nonce. */
const MAX_NONCE_LENGTH = 100;

/**
 * `clientNonce` tuỳ chọn: chuỗi khác rỗng, tối đa 100 ký tự mới dùng làm khoá
 * chống trùng. Nonce quá dài (client cũ/hỏng) bị bỏ qua thay vì từ chối tin —
 * tránh dedup nhầm hai tin khác nhau nhưng cùng tiền tố.
 */
function parseNonce(value: unknown): string | undefined {
  return typeof value === "string" &&
    value !== "" &&
    value.length <= MAX_NONCE_LENGTH
    ? value
    : undefined;
}

/**
 * Gắn toàn bộ hành vi namespace `/inbox` lên instance socket.io.
 *
 * `prisma` được tiêm vào (không import `lib/db.ts`) — cùng hợp đồng với flow,
 * để test integration truyền `testPrisma` và production truyền singleton.
 */
export function attachInboxGateway(
  io: Server,
  prisma: PrismaClient,
  deps: { aiRunner?: AiRunner } = {},
): void {
  const aiRunner = deps.aiRunner ?? createAiRunner();

  // `io.of()` trả Namespace generic mặc định; ép một chỗ về event map của
  // gateway để mọi emit/listener bên dưới được kiểm type.
  const nsp = io.of(INBOX_NAMESPACE) as unknown as Namespace<
    InboxClientToServerEvents,
    InboxServerToClientEvents,
    InboxInterServerEvents,
    InboxSocketData
  >;

  // Handshake: JWT từ `auth.token`; SELLER còn phải sở hữu một shop. Thiếu/
  // hỏng/hết hạn → 'unauthorized', seller vô chủ → 'forbidden' (client nhận
  // `connect_error`, không bao giờ vào được namespace).
  nsp.use(async (socket, next) => {
    try {
      const token: unknown = socket.handshake.auth?.token;
      if (typeof token !== "string" || token === "") {
        next(new Error("unauthorized"));
        return;
      }
      const payload = await verifyToken(token);
      if (payload === null) {
        next(new Error("unauthorized"));
        return;
      }
      if (payload.role === "SELLER") {
        const shop = await prisma.shop.findFirst({
          where: { ownerId: payload.userId },
          select: { id: true },
        });
        if (shop === null) {
          next(new Error("forbidden"));
          return;
        }
        socket.data.shopId = shop.id;
      }
      socket.data.user = payload;
      next();
    } catch (error: unknown) {
      console.error("[inbox] Lỗi handshake:", error);
      next(new Error("unauthorized"));
    }
  });

  /**
   * `join_conversation {conversationId}`: chủ hội thoại (buyer là `buyerId`,
   * seller là chủ shop) mới được vào phòng; thành công còn phát hiện trạng
   * `conversation_updated` cho riêng socket để UI dựng đúng mode/version.
   */
  async function joinConversation(socket: InboxSocket, payload: unknown): Promise<void> {
    const conversationId = parseConversationId(asRecord(payload));
    const user = socket.data.user;
    if (conversationId === null) {
      socket.emit("inbox_error", { message: INVALID_PAYLOAD_MESSAGE });
      return;
    }

    try {
      const conversation = await prisma.conversation.findUnique({
        where: { id: conversationId },
        select: { id: true, buyerId: true, shopId: true, mode: true, version: true },
      });
      // Một thông báo duy nhất cho "không tồn tại" lẫn "không phải của bạn" —
      // không để người ngoài dò được hội thoại nào tồn tại.
      const allowed =
        conversation !== null &&
        (user.role === "BUYER"
          ? conversation.buyerId === user.userId
          : conversation.shopId === socket.data.shopId);
      if (!allowed) {
        socket.emit("inbox_error", {
          conversationId,
          message: NO_ACCESS_MESSAGE,
        });
        return;
      }

      await socket.join(conversationRoom(conversationId));
      socket.emit("conversation_updated", {
        conversationId,
        mode: conversation.mode,
        version: conversation.version,
      });
    } catch (error: unknown) {
      console.error("[inbox] Lỗi join_conversation:", error);
      socket.emit("inbox_error", {
        conversationId,
        message: SYSTEM_ERROR_MESSAGE,
      });
    }
  }

  /**
   * `send_message {conversationId, content, clientNonce?}`: validate nội dung
   * trước (trim 1..2000 — sai thì `inbox_error`, không chạm DB); quyền hội thoại
   * quyết định đi `handleBuyerMessage` hay `handleSellerMessage`.
   */
  async function sendMessage(socket: InboxSocket, payload: unknown): Promise<void> {
    const record = asRecord(payload);
    const conversationId = parseConversationId(record);
    const content = parseContent(record?.content);
    if (conversationId === null || content === null) {
      socket.emit("inbox_error", {
        conversationId: conversationId ?? undefined,
        message: INVALID_CONTENT_MESSAGE,
      });
      return;
    }

    try {
      const user = socket.data.user;
      // Đọc nguyên dòng: buyer cần đủ `Conversation` để chuyển cho flow, seller
      // chỉ cần `shopId` — một query phục vụ cả hai nhánh.
      const conversation = await prisma.conversation.findUnique({
        where: { id: conversationId },
      });
      if (conversation === null) {
        socket.emit("inbox_error", { conversationId, message: NO_ACCESS_MESSAGE });
        return;
      }

      if (user.role === "BUYER") {
        if (conversation.buyerId !== user.userId) {
          socket.emit("inbox_error", { conversationId, message: NO_ACCESS_MESSAGE });
          return;
        }
        await handleBuyerMessage(
          { prisma, io, aiRunner },
          {
            conversation,
            buyerId: user.userId,
            text: content,
            clientNonce: parseNonce(record?.clientNonce),
          },
        );
        return;
      }

      const shopId = socket.data.shopId;
      if (shopId === undefined || conversation.shopId !== shopId) {
        socket.emit("inbox_error", { conversationId, message: NO_ACCESS_MESSAGE });
        return;
      }
      await handleSellerMessage(
        { prisma, io },
        { conversationId, sellerShopId: shopId, content },
      );
    } catch (error: unknown) {
      console.error("[inbox] Lỗi send_message:", error);
      socket.emit("inbox_error", {
        conversationId,
        message:
          error instanceof ApiError ? error.message : SYSTEM_ERROR_MESSAGE,
      });
    }
  }

  /** `hand_back_to_ai {conversationId}` — seller-only, đổi mode AI/version + 1. */
  async function handBackToAi(socket: InboxSocket, payload: unknown): Promise<void> {
    const conversationId = parseConversationId(asRecord(payload));
    if (conversationId === null) {
      socket.emit("inbox_error", { message: INVALID_PAYLOAD_MESSAGE });
      return;
    }

    try {
      const user = socket.data.user;
      const shopId = socket.data.shopId;
      if (user.role !== "SELLER" || shopId === undefined) {
        socket.emit("inbox_error", {
          conversationId,
          message: SELLER_ONLY_MESSAGE,
        });
        return;
      }

      const conversation = await prisma.conversation.findUnique({
        where: { id: conversationId },
        select: { shopId: true },
      });
      if (conversation === null || conversation.shopId !== shopId) {
        socket.emit("inbox_error", { conversationId, message: NO_ACCESS_MESSAGE });
        return;
      }

      await handleHandBackToAi({ prisma, io }, { conversationId, sellerShopId: shopId });
    } catch (error: unknown) {
      console.error("[inbox] Lỗi hand_back_to_ai:", error);
      socket.emit("inbox_error", {
        conversationId,
        message:
          error instanceof ApiError ? error.message : SYSTEM_ERROR_MESSAGE,
      });
    }
  }

  nsp.on("connection", (socket) => {
    const { user, shopId } = socket.data;
    // Seller nghe cả shop của mình ngay khi connect — inbox list cập nhật mà
    // không phải join từng hội thoại.
    if (user.role === "SELLER" && shopId !== undefined) {
      void socket.join(shopInboxRoom(shopId));
    }

    socket.on("join_conversation", (payload) => {
      void joinConversation(socket, payload).catch((error: unknown) => {
        console.error("[inbox] Lỗi xử lý join_conversation:", error);
      });
    });
    socket.on("send_message", (payload) => {
      void sendMessage(socket, payload).catch((error: unknown) => {
        console.error("[inbox] Lỗi xử lý send_message:", error);
      });
    });
    socket.on("hand_back_to_ai", (payload) => {
      void handBackToAi(socket, payload).catch((error: unknown) => {
        console.error("[inbox] Lỗi xử lý hand_back_to_ai:", error);
      });
    });
  });
}
