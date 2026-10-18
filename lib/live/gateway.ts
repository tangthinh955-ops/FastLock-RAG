import type { Namespace, Server, Socket } from "socket.io";
import type { Match } from "../aho-corasick";
import { verifyToken, type TokenPayload } from "../auth/token";
import { schedulePaymentReminder } from "../chat/reminders";
import { LIVE_NAMESPACE, liveRoom } from "../socket-registry";
import { startFakeComments, stopFakeComments } from "./fake-comments";
import {
  processComment,
  type LiveServicePrisma,
  type OrderSummary,
} from "./service";

/**
 * Gateway socket.io namespace `/live` (Task 10) — lớp mỏng nối socket ⟷
 * `processComment` (Task 9) ⟷ fake comments (demo).
 *
 * Bất biến (spec §7.1/§7.2, plan "Review Focus" #1/#5):
 * - **Danh tính chỉ từ JWT**: handshake `auth.token` → `verifyToken` →
 *   `socket.data.user`. Mọi field `buyerId`/`userId`/`role` trong payload sự
 *   kiện bị bỏ qua hoàn toàn (không đọc tới).
 * - **Che SĐT trước khi phát**: gateway chỉ phát `result.text` — chuỗi đã che
 *   sẵn trong pipeline của service; `matches` cũng tính trên chuỗi đã che nên
 *   vị trí highlight khớp đúng text phát đi.
 * - **Chống trùng**: cùng `nonce` gửi lại ⇒ `duplicate: true` ⇒ chỉ phát
 *   `comment`, KHÔNG phát `new_order` lần hai.
 *
 * Quy tắc phát (đã chốt, Task 11–14 dựa vào):
 * - `comment` phát vào phòng `live:{sessionId}` (gồm cả người vừa gửi — kiểu
 *   TikTok ai cũng thấy comment của mình xuất hiện), `new_order` cũng vậy.
 * - Lỗi phía người gửi (payload sai, text > 200 ký tự, text trắng) ⇒ comment
 *   `kind: "system"` "Tin nhắn không hợp lệ" **gửi riêng cho client đó**
 *   (không làm rác phòng vì lỗi thao tác cá nhân).
 * - Phiên không (còn) LIVE ⇒ `live_ended { sessionId }` gửi riêng cho client
 *   (đúng như `join_live` thất bại) để UI kịp hiện banner "Live đã kết thúc".
 * - Hết kho ⇒ kèm thêm comment system `"{sku} đã hết hàng"` phát vào phòng
 *   (cả phòng cần biết mã vừa cháy hàng — spec §15).
 *
 * Comment system mang danh tính tổng đài ảo: `userId: "system"`,
 * `userName: "Hệ thống"`, `matches: []`, không `elapsedMs`.
 */

/** Sự kiện server → client: một dòng chat trong feed (user hoặc system). */
export type CommentEvent = {
  userId: string;
  userName: string;
  text: string;
  /** Vị trí SKU khớp trên CHÍNH `text` phát đi (hệ toạ độ UTF-16) — để highlight. */
  matches: Match[];
  kind: "user" | "system";
  /** Số ms thật của Aho-Corasick — chỉ có ở comment người gửi (kind 'user'). */
  elapsedMs?: number;
  /** ISO 8601 — JSON transport không mang Date; client tự format. */
  createdAt: string;
};

/** Sự kiện server → room: đơn vừa nổ. */
export type NewOrderEvent = {
  order: OrderSummary;
  buyerId: string;
  buyerName: string;
};

/** Sự kiện server → room: số người xem ảo (RAM) đổi. */
export type ViewersEvent = { count: number };

/** Sự kiện server → namespace (phát từ REST Task 11 qua registry). */
export type LiveStartedEvent = {
  session: { id: string; title: string; shopName: string };
};

/** Sự kiện server → client/namespace: phiên đã kết thúc hoặc không còn LIVE. */
export type LiveEndedEvent = { sessionId: string };

export type LiveServerToClientEvents = {
  comment: (event: CommentEvent) => void;
  new_order: (event: NewOrderEvent) => void;
  viewers: (event: ViewersEvent) => void;
  live_started: (event: LiveStartedEvent) => void;
  live_ended: (event: LiveEndedEvent) => void;
};

/**
 * Payload client→server khai báo `unknown` có chủ đích: client có thể gửi bất
 * kỳ thứ gì, gateway tự validate — không tạo cảm giác an toàn giả bằng type.
 */
export type LiveClientToServerEvents = {
  join_live: (payload: unknown) => void;
  send_comment: (payload: unknown) => void;
  toggle_fake: (payload: unknown) => void;
};

export type LiveInterServerEvents = Record<string, never>;
export type LiveSocketData = { user: TokenPayload };

export type LiveSocket = Socket<
  LiveClientToServerEvents,
  LiveServerToClientEvents,
  LiveInterServerEvents,
  LiveSocketData
>;

const SYSTEM_USER_ID = "system";
const SYSTEM_USER_NAME = "Hệ thống";

/** Giới hạn độ dài comment do UI gửi lên (Task 14 chặn ở client, gateway chặn lại). */
const MAX_COMMENT_LENGTH = 200;

const INVALID_MESSAGE_TEXT = "Tin nhắn không hợp lệ";

/** Payload dạng object? Trả record để đọc field, ngược lại `null`. */
function asRecord(payload: unknown): Record<string, unknown> | null {
  return typeof payload === "object" && payload !== null
    ? (payload as Record<string, unknown>)
    : null;
}

/** `sessionId` hợp lệ? Thiếu/sai kiểu → `null` (người gọi tự quyết định im lặng). */
function parseSessionId(payload: unknown): string | null {
  const sessionId = asRecord(payload)?.sessionId;
  return typeof sessionId === "string" && sessionId !== "" ? sessionId : null;
}

type ParsedSendComment = {
  sessionId: string;
  text: string;
  nonce: string | undefined;
};

/** `{ sessionId, text, nonce? }` — text quá 200 ký tự coi như không hợp lệ. */
function parseSendComment(payload: unknown): ParsedSendComment | null {
  const record = asRecord(payload);
  if (record === null) {
    return null;
  }
  const sessionId = parseSessionId(record);
  const { text, nonce } = record;
  if (
    sessionId === null ||
    typeof text !== "string" ||
    text.length > MAX_COMMENT_LENGTH
  ) {
    return null;
  }
  return {
    sessionId,
    text,
    nonce: typeof nonce === "string" ? nonce : undefined,
  };
}

/** `{ sessionId, enabled }` — thiếu/sai kiểu → `null`. */
function parseToggleFake(
  payload: unknown,
): { sessionId: string; enabled: boolean } | null {
  const record = asRecord(payload);
  if (record === null) {
    return null;
  }
  const sessionId = parseSessionId(record);
  const { enabled } = record;
  if (sessionId === null || typeof enabled !== "boolean") {
    return null;
  }
  return { sessionId, enabled };
}

/** Comment system dùng chung cho mọi thông báo do máy phát. */
function systemComment(text: string): CommentEvent {
  return {
    userId: SYSTEM_USER_ID,
    userName: SYSTEM_USER_NAME,
    text,
    matches: [],
    kind: "system",
    createdAt: new Date().toISOString(),
  };
}

/**
 * Gắn toàn bộ hành vi namespace `/live` lên instance socket.io.
 *
 * `prisma` được tiêm vào (không import `lib/db.ts`) — cùng hợp đồng với
 * `processComment`, để test integration truyền `testPrisma` và production
 * truyền singleton từ `server.ts`.
 */
export function attachLiveGateway(io: Server, prisma: LiveServicePrisma): void {
  // `io.of()` trả Namespace generic mặc định; ép về event map của gateway để
  // mọi emit/listener bên dưới được kiểm type. Việc ép nằm gọn một chỗ.
  const nsp = io.of(LIVE_NAMESPACE) as unknown as Namespace<
    LiveClientToServerEvents,
    LiveServerToClientEvents,
    LiveInterServerEvents,
    LiveSocketData
  >;

  // Handshake: JWT từ `auth.token`. Thiếu/hỏng/hết hạn → 'unauthorized'
  // (client nhận `connect_error`), không bao giờ cho socket vào namespace.
  // try/catch phòng xa: verifyToken theo hợp đồng không throw, nhưng mọi lỗi
  // bất ngờ cũng phải kết thúc handshake thay vì treo client.
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
      socket.data.user = payload;
      next();
    } catch (error: unknown) {
      console.error("[live] Lỗi handshake:", error);
      next(new Error("unauthorized"));
    }
  });

  async function joinLive(socket: LiveSocket, payload: unknown): Promise<void> {
    const sessionId = parseSessionId(payload);
    if (sessionId === null) {
      return; // payload rác: không có gì để báo, im lặng
    }

    const session = await prisma.liveSession.findUnique({
      where: { id: sessionId },
      select: { status: true },
    });
    if (session === null || session.status !== "LIVE") {
      socket.emit("live_ended", { sessionId });
      return;
    }

    await socket.join(liveRoom(sessionId));
  }

  async function sendComment(
    socket: LiveSocket,
    payload: unknown,
  ): Promise<void> {
    const parsed = parseSendComment(payload);
    if (parsed === null) {
      socket.emit("comment", systemComment(INVALID_MESSAGE_TEXT));
      return;
    }

    // Danh tính DUY NHẤT: socket.data.user (đã verify JWT ở handshake).
    const user = socket.data.user;
    const result = await processComment(prisma, {
      sessionId: parsed.sessionId,
      user,
      rawText: parsed.text,
      clientNonce: parsed.nonce,
    });

    if (!result.ok) {
      if (result.reason === "NO_LIVE_SESSION") {
        socket.emit("live_ended", { sessionId: parsed.sessionId });
        return;
      }
      // EMPTY_TEXT: người gửi gõ khoảng trắng — báo tại chỗ.
      socket.emit("comment", systemComment(INVALID_MESSAGE_TEXT));
      return;
    }

    nsp.to(liveRoom(parsed.sessionId)).emit("comment", {
      userId: user.userId,
      userName: user.name,
      text: result.text,
      matches: result.matches,
      kind: "user",
      elapsedMs: result.elapsedMs,
      createdAt: new Date().toISOString(),
    });

    // Đơn mới chỉ khi THẬT SỰ tạo mới — retry cùng nonce không đổ chuông lần 2.
    if (result.order !== undefined && result.duplicate !== true) {
      nsp.to(liveRoom(parsed.sessionId)).emit("new_order", {
        order: result.order,
        buyerId: user.userId,
        buyerName: user.name,
      });

      // Task 8: hẹn nhắc thanh toán 5' (env `PAYMENT_REMIND_DELAY_MS` rút ngắn
      // cho smoke). `prisma` tiêm vào là testPrisma ở test — timer chạy nền,
      // dedup `order:{id}:remind` bảo đảm 1 tin/đơn kể cả khi end-live nhắc trước.
      schedulePaymentReminder(result.order.id, user.userId, result.shopId, {
        prisma,
      });
    }

    if (result.outOfStockSku !== undefined) {
      nsp
        .to(liveRoom(parsed.sessionId))
        .emit("comment", systemComment(`${result.outOfStockSku} đã hết hàng`));
    }
  }

  async function toggleFake(
    socket: LiveSocket,
    payload: unknown,
  ): Promise<void> {
    const parsed = parseToggleFake(payload);
    if (parsed === null) {
      return;
    }

    const user = socket.data.user;
    // Không phải seller → bỏ qua im lặng (không tiết lộ gì qua phản hồi).
    if (user.role !== "SELLER") {
      return;
    }

    const session = await prisma.liveSession.findUnique({
      where: { id: parsed.sessionId },
      select: { id: true, shopId: true },
    });
    if (session === null) {
      return;
    }

    const shop = await prisma.shop.findUnique({
      where: { ownerId: user.userId },
      select: { id: true, name: true },
    });
    // Seller không sở hữu shop của phiên → bỏ qua im lặng.
    if (shop === null || shop.id !== session.shopId) {
      return;
    }

    if (parsed.enabled) {
      startFakeComments(io, session.id, shop.name);
    } else {
      stopFakeComments(session.id);
    }
  }

  nsp.on("connection", (socket) => {
    socket.on("join_live", (payload) => {
      void joinLive(socket, payload).catch((error: unknown) => {
        console.error("[live] Lỗi xử lý join_live:", error);
      });
    });
    socket.on("send_comment", (payload) => {
      void sendComment(socket, payload).catch((error: unknown) => {
        console.error("[live] Lỗi xử lý send_comment:", error);
      });
    });
    socket.on("toggle_fake", (payload) => {
      void toggleFake(socket, payload).catch((error: unknown) => {
        console.error("[live] Lỗi xử lý toggle_fake:", error);
      });
    });
  });
}
