import type { Namespace, Server } from "socket.io";
import type {
  ChatMode,
  Conversation,
  DirectMessage,
  MessageSource,
  PrismaClient,
} from "../../generated/prisma/client";
import {
  conversationRoom,
  INBOX_NAMESPACE,
  shopInboxRoom,
} from "../socket-registry";
import type { AiAnswer, AiRunner, AiTrace } from "./ai";
import {
  appendMessage,
  getMessages,
  handBackToAi,
  sellerSendMessage,
} from "./service";

/**
 * Luồng nghiệp vụ Inbox (Task 7 — spec §7.4/§7.6): orchestrate tin buyer/seller
 * với runner AI và takeover. File này KHÔNG import gateway: tầng socket chỉ
 * được chạm qua `createInboxEmitter` (một chỗ ép type), còn gateway Task 7/8 chỉ
 * là plumbing mỏng gọi vào đây.
 *
 * Bất biến quan trọng nhất — TAKEOVER THẮNG CẢ KHI ĐANG BAY (Review Focus #2):
 * trước khi gọi runner, luồng chốt `mode/version` lúc dispatch; khi runner trả
 * về (thành công HAY ném lỗi), đọc LẠI hội thoại; nếu `mode !== "AI"` hoặc
 * `version` đã đổi (seller vừa gõ tay / vừa trả-AI lần khác) thì HỦY IM LẶNG —
 * không lưu row, không phát socket. Nhờ vậy AI không bao giờ chèn tin vào đoạn
 * seller đang trả lời, kể cả tin "xin lỗi" khi runner hỏng sau lúc takeover.
 * `ai_thinking false` vẫn phát ở `finally` cho MỌI nhánh để UI không kẹt spinner.
 *
 * Chống trùng (spec §7.6): `clientNonce` → `dedupKey = msg:{conversationId}:{nonce}`
 * (unique mức DB của `appendMessage`); lần gửi lại dừng im lặng — không phát
 * lại `message` và cũng không chạy AI thêm lần nào.
 */

/** `message`: một tin mới trong hội thoại (BUYER/SELLER/AI cùng shape; SYSTEM dùng cho tin nhắc thanh toán — Task 8). */
export type InboxMessageEvent = {
  message: {
    id: string;
    conversationId: string;
    source: MessageSource;
    content: string;
    orderId?: string;
    trace?: unknown;
    /** ISO 8601 — JSON transport không mang Date. */
    createdAt: string;
  };
};

/** `conversation_updated`: mode/version mới sau takeover hoặc trả-AI. */
export type InboxConversationEvent = {
  conversationId: string;
  mode: ChatMode;
  version: number;
};

/** `ai_thinking`: AI bắt đầu/kết thúc trả lời (UI hiện "đang trả lời"). */
export type InboxAiThinkingEvent = {
  conversationId: string;
  thinking: boolean;
};

/** `inbox_error`: lỗi riêng cho MỘT socket (payload sai, sai quyền, hệ thống…) — không phát vào phòng. */
export type InboxErrorEvent = {
  conversationId?: string;
  message: string;
};

/** Số tin cuối nạp làm lịch sử cho runner (spec §7.4). */
const HISTORY_TAKE = 20;

/** Tin xin lỗi khi runner hỏng bất ngờ — nội dung cho KHÁCH, không lộ chi tiết kỹ thuật. */
const AI_APOLOGY =
  "Xin lỗi bạn, hệ thống đang bận nên chưa trả lời được ngay. Bạn nhắn lại giúp mình sau ít phút nhé.";

/** Nhãn model trong trace của tin xin lỗi — UI kỹ thuật phân biệt được với tin AI thật. */
const AI_ERROR_MODEL = "inbox-error";

/** Ba sự kiện server→client do lớp luồng phát ra (emit tầng socket, đã ép type). */
type InboxFlowEmitEvents = {
  message: (event: InboxMessageEvent) => void;
  conversation_updated: (event: InboxConversationEvent) => void;
  ai_thinking: (event: InboxAiThinkingEvent) => void;
};

/** Đủ để định vị phòng phát của một hội thoại. */
type InboxConversationRef = { id: string; shopId: string };

/**
 * Emitter của `/inbox` — bọc DUY NHẤT một chỗ việc ép type namespace và quy
 * tắc phòng. Mọi sự kiện phát vào cả `conversation:{id}` (buyer + seller đang mở
 * hội thoại) lẫn `shop:{shopId}` (mọi phiên seller của shop); socket.io khử
 * trùng theo từng socket nên seller nằm cả hai phòng vẫn nhận đúng một lần.
 */
export type InboxEmitter = {
  message(conversation: InboxConversationRef, row: DirectMessage): void;
  conversationUpdated(
    conversation: InboxConversationRef & { mode: ChatMode; version: number },
  ): void;
  aiThinking(conversation: InboxConversationRef, thinking: boolean): void;
};

/**
 * Row `DirectMessage` → payload `message` phát đi (bỏ `dedupKey`, không rò ra
 * ngoài). Export để luồng khác cũng phát `message` đúng shape — Task 8 (nhắc
 * thanh toán) phát tin SYSTEM qua cùng một phép biến đổi, không tự chế payload.
 */
export function toMessageEvent(row: DirectMessage): InboxMessageEvent["message"] {
  return {
    id: row.id,
    conversationId: row.conversationId,
    source: row.source,
    content: row.content,
    orderId: row.orderId ?? undefined,
    trace: row.trace ?? undefined,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Tạo emitter cho một instance socket.io. Export riêng để test/tương lai có thể
 * phát cùng quy tắc phòng mà không cần dựng gateway.
 */
export function createInboxEmitter(io: Server): InboxEmitter {
  const nsp = io.of(INBOX_NAMESPACE) as unknown as Namespace<
    Record<string, never>,
    InboxFlowEmitEvents,
    Record<string, never>,
    unknown
  >;

  const toRooms = (conversation: InboxConversationRef) =>
    nsp
      .to(conversationRoom(conversation.id))
      .to(shopInboxRoom(conversation.shopId));

  return {
    message(conversation, row) {
      toRooms(conversation).emit("message", { message: toMessageEvent(row) });
    },
    conversationUpdated(conversation) {
      toRooms(conversation).emit("conversation_updated", {
        conversationId: conversation.id,
        mode: conversation.mode,
        version: conversation.version,
      });
    },
    aiThinking(conversation, thinking) {
      toRooms(conversation).emit("ai_thinking", {
        conversationId: conversation.id,
        thinking,
      });
    },
  };
}

/** Trace tối thiểu cho tin xin lỗi: đủ shape UI đọc (`readTrace`) + `error`. */
function apologyTrace(error: unknown, startedAt: number): AiTrace {
  return {
    model: AI_ERROR_MODEL,
    topK: [],
    products: [],
    tokens: { prompt: 0, completion: 0 },
    elapsedMs: Date.now() - startedAt,
    error: error instanceof Error ? error.message : String(error),
  };
}

/**
 * Buyer gửi tin (đã qua validate ở gateway) — trái tim của luồng AI/takeover:
 *
 * 1. Lưu tin BUYER (kèm `dedupKey` nếu có nonce); trùng → dừng im lặng.
 * 2. Phát `message` vào phòng hội thoại + phòng shop.
 * 3. Hội thoại không còn AI (seller đã takeover từ trước) → dừng, không AI.
 * 4. Chốt `version` dispatch, phát `ai_thinking true`, đọc tin cuối (bỏ câu hỏi
 *    hiện tại) làm history rồi gọi runner.
 * 5. Đọc LẠI hội thoại: `mode !== "AI"` hoặc `version` đổi → hủy im lặng
 *    (áp cho cả nhánh runner thành công lẫn nhánh lỗi — takeover thắng).
 * 6. Ngược lại lưu tin AI (kèm `trace`) rồi phát `message`; runner lỗi bất ngờ →
 *    tin xin lỗi ngắn (trace có `error`).
 * 7. `finally`: luôn `ai_thinking false`.
 */
export async function handleBuyerMessage(
  deps: { prisma: PrismaClient; io: Server; aiRunner?: AiRunner },
  input: {
    conversation: Conversation;
    buyerId: string;
    text: string;
    clientNonce?: string;
  },
): Promise<void> {
  const { prisma } = deps;
  const { conversation, text } = input;
  const emitter = createInboxEmitter(deps.io);

  const dedupKey =
    input.clientNonce === undefined
      ? undefined
      : `msg:${conversation.id}:${input.clientNonce}`;
  const buyerRow = await appendMessage(prisma, {
    conversationId: conversation.id,
    source: "BUYER",
    content: text,
    dedupKey,
  });
  if (buyerRow === null) {
    return; // nonce trùng: đã có tin này rồi — không phát lại, không chạy AI
  }
  emitter.message(conversation, buyerRow);

  const atDispatch = await prisma.conversation.findUnique({
    where: { id: conversation.id },
    select: { mode: true, version: true },
  });
  if (atDispatch === null || atDispatch.mode !== "AI") {
    return; // seller đã tiếp quản (hoặc hội thoại biến mất) — không ai_thinking
  }
  const dispatchVersion = atDispatch.version;

  const runner = deps.aiRunner;
  if (runner === undefined) {
    return; // chưa cấu hình runner AI — chỉ ghi tin buyer
  }

  emitter.aiThinking(conversation, true);
  const startedAt = Date.now();
  try {
    let outcome: { ok: true; answer: AiAnswer } | { ok: false; error: unknown };
    try {
      const recent = await getMessages(prisma, conversation.id, {
        // Lấy dư 1 tin để bỏ chính câu hỏi hiện tại (đã truyền riêng qua `text`
        // cho runner) — nếu không, prompt sẽ lặp câu hỏi: một lần trong history
        // và một lần ở cuối `buildPrompt`.
        take: HISTORY_TAKE + 1,
      });
      const history = recent
        .filter((row) => row.id !== buyerRow.id)
        .slice(-HISTORY_TAKE);
      outcome = {
        ok: true,
        answer: await runner.answer(prisma, {
          conversationId: conversation.id,
          shopId: conversation.shopId,
          buyerId: input.buyerId,
          text,
          history: history.map((row) => ({ source: row.source, content: row.content })),
        }),
      };
    } catch (error: unknown) {
      outcome = { ok: false, error };
    }

    // Takeover thắng cả khi đang bay: runner về sau khi seller gõ tay (hoặc trả
    // AI lần khác) → bỏ TOÀN BỘ kết quả, kể cả tin xin lỗi của nhánh lỗi.
    const atAnswer = await prisma.conversation.findUnique({
      where: { id: conversation.id },
      select: { mode: true, version: true },
    });
    if (
      atAnswer === null ||
      atAnswer.mode !== "AI" ||
      atAnswer.version !== dispatchVersion
    ) {
      return; // hủy im lặng
    }

    const aiRow = outcome.ok
      ? await appendMessage(prisma, {
          conversationId: conversation.id,
          source: "AI",
          content: outcome.answer.content,
          trace: outcome.answer.trace,
        })
      : await appendMessage(prisma, {
          conversationId: conversation.id,
          source: "AI",
          content: AI_APOLOGY,
          trace: apologyTrace(outcome.error, startedAt),
        });
    if (aiRow !== null) {
      emitter.message(conversation, aiRow);
    }
  } finally {
    emitter.aiThinking(conversation, false);
  }
}

/**
 * Seller gõ tay — takeover: `sellerSendMessage` nâng version + đổi mode HUMAN
 * trong MỘT transaction (guard shop ở service); sau đó phát tin SELLER và
 * `conversation_updated` với mode/version MỚI để mọi UI (buyer lẫn seller khác)
 * khóa ô nhập AI lại. ApiError (sai shop/không có hội thoại) ném ra cho gateway
 * chuyển thành `inbox_error`.
 */
export async function handleSellerMessage(
  deps: { prisma: PrismaClient; io: Server },
  input: { conversationId: string; sellerShopId: string; content: string },
): Promise<void> {
  const { message, conversation } = await sellerSendMessage(deps.prisma, input);
  const emitter = createInboxEmitter(deps.io);
  emitter.message(conversation, message);
  emitter.conversationUpdated(conversation);
}

/**
 * "Trả lại cho AI" — seller-only (gateway chặn vai trò): `handBackToAi` đổi
 * mode AI + version + 1 trong transaction; phát `conversation_updated`, KHÔNG
 * tạo tin nào — AI tư vấn lại từ tin buyer kế tiếp.
 */
export async function handleHandBackToAi(
  deps: { prisma: PrismaClient; io: Server },
  input: { conversationId: string; sellerShopId: string },
): Promise<void> {
  const conversation = await handBackToAi(deps.prisma, input);
  createInboxEmitter(deps.io).conversationUpdated(conversation);
}
