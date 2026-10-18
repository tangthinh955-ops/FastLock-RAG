import type { Namespace } from "socket.io";
import type { PrismaClient } from "../../generated/prisma/client";
import { prisma as appPrisma } from "../db";
import {
  conversationRoom,
  getInboxIo,
  INBOX_NAMESPACE,
  shopInboxRoom,
} from "../socket-registry";
import { toMessageEvent, type InboxMessageEvent } from "./flow";
import { appendMessage, getOrCreateConversation } from "./service";

/**
 * Nhắc thanh toán "dây A" (Task 8 — spec §7.6 chống trùng, §8 dây chuyền demo):
 * đơn chốt trong live còn `PENDING` được nhắc ĐÚNG MỘT LẦN vào hội thoại Inbox,
 * qua hai đường:
 *
 * 1. **Timer 5 phút** sau khi đơn được tạo (`schedulePaymentReminder` — hook ở
 *    `lib/live/gateway.ts`).
 * 2. **Hook end-live** (`remindPendingOrdersForSession` — hook ở
 *    `lib/live/sessions.ts`): phiên hạ màn, mọi đơn còn PENDING được nhắc ngay.
 *
 * Hai đường có thể chồng nhau (timer nổ sau end-live vài giây, end-live chạy
 * chồng do double-click…). **Nguồn sự thật duy nhất là dedup mức DB**:
 * `dedupKey = "order:{orderId}:remind"` (unique) — `appendMessage` trả `null`
 * ở lần gửi thứ hai, khi đó KHÔNG ghi và KHÔNG phát lại socket. Nhờ vậy
 * "1 tin/đơn" đúng trong mọi thứ tự, không cần khoá RAM nào.
 *
 * Bất biến khi gửi (đường nào cũng vậy):
 * - ĐỌC LẠI đơn ngay lúc gửi: không còn → im lặng; `status !== PENDING` (đã trả
 *   tiền/đã giao…) → im lặng — không nhắc đơn đã thanh toán dù lịch đã hẹn.
 * - Nội dung chỉ nói sự thật demo: mã đơn, SP ×số lượng, tổng tiền, giữ hàng
 *   15 phút, hướng khách mở "Đơn của tôi" — không hứa QR (Plan 3 chưa có).
 *
 * Timer lưu ở `globalThis.__liveReminders` (bài học R18: Next đóng gói app code
 * theo từng bundle, biến module-local của gateway/route là HAI instance khác
 * nhau dù cùng process — `globalThis` mới là sổ chung). Timer `unref()` để nhắc
 * nhở best-effort không giữ process sống; process tắt thì lịch hẹn mất, còn
 * lưới an toàn end-live + dedup ở trên.
 */

/** Mốc nhắc mặc định: 5 phút sau khi chốt đơn (brief Task 8). */
export const PAYMENT_REMIND_DELAY_MS = 5 * 60_000;

/** Số phút shop giữ hàng trong kịch bản demo (chỉ dùng cho câu chữ). */
const HOLD_MINUTES = 15;

/**
 * Phụ thuộc tuỳ chọn — test tiêm `testPrisma` + emit giả + delay ngắn; production
 * bỏ trống hết: prisma singleton `lib/db`, delay từ hằng số/env, emit qua registry.
 */
export type ReminderDeps = {
  prisma?: PrismaClient;
  delayMs?: number;
  emit?: (
    event: InboxMessageEvent,
    conversationId: string,
    shopId: string,
  ) => void;
};

/** Đủ để nhắm một đơn: id + danh tính người nhận (bất biến trên `Order`). */
type ReminderTarget = { orderId: string; buyerId: string; shopId: string };

declare global {
  /** Sổ timer nhắc thanh toán theo đơn — chung mọi bundle trong process (R18). */
  var __liveReminders: Map<string, NodeJS.Timeout> | undefined;
}

/** Sổ timer toàn cục, khởi tạo lười ở lần dùng đầu tiên. */
function reminderTimers(): Map<string, NodeJS.Timeout> {
  const existing = globalThis.__liveReminders;
  if (existing !== undefined) {
    return existing;
  }
  const created = new Map<string, NodeJS.Timeout>();
  globalThis.__liveReminders = created;
  return created;
}

/** "240000" → "240.000" — tách nghìn bằng dấu chấm, không phụ thuộc locale/ICU. */
function formatVnd(value: number): string {
  return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/** Nội dung tin nhắc — tiếng Việt tự nhiên, chỉ số liệu thật của đơn. */
function reminderContent(order: {
  code: number;
  qty: number;
  total: number;
  product: { name: string };
}): string {
  return (
    `⏰ Đơn #${order.code} (${order.product.name} ×${order.qty} — ` +
    `${formatVnd(order.total)}đ) vẫn đang chờ thanh toán. ` +
    `Shop chỉ giữ hàng ${HOLD_MINUTES} phút kể từ lúc chốt nhé, ` +
    `bạn mở mục "Đơn của tôi" để thanh toán nha!`
  );
}

/** Event map tối thiểu của namespace `/inbox` cho một chỗ ép type khi phát. */
type InboxEmitEvents = { message: (event: InboxMessageEvent) => void };

/**
 * Emit mặc định của production: socket server lấy từ registry (`getInboxIo`,
 * R18) và phát vào đúng hai phòng như `createInboxEmitter` — `conversation:{id}`
 * (buyer + seller đang mở) và `shop:{shopId}` (mọi phiên seller của shop).
 * Không có io (CLI, test) → bỏ qua im lặng: tin đã nằm trong DB, UI nạp lại vẫn thấy.
 */
function registryEmit(
  event: InboxMessageEvent,
  conversationId: string,
  shopId: string,
): void {
  const io = getInboxIo();
  if (io === null) {
    return;
  }
  const nsp = io.of(INBOX_NAMESPACE) as unknown as Namespace<
    Record<string, never>,
    InboxEmitEvents,
    Record<string, never>,
    unknown
  >;
  nsp
    .to(conversationRoom(conversationId))
    .to(shopInboxRoom(shopId))
    .emit("message", event);
}

/**
 * Gửi nhắc cho MỘT đơn — điểm vào chung của timer và end-live. Trả `true` khi
 * thật sự ghi và phát một tin MỚI.
 *
 * `target.buyerId`/`target.shopId` là danh tính lúc hẹn: `Order` không có đường
 * code nào đổi hai field này, còn code/qty/total/tên SP luôn lấy từ lần ĐỌC LẠI
 * ngay trước khi gửi (giá trị dùng trong tin phải khớp DB).
 */
async function deliverReminder(
  prisma: PrismaClient,
  deps: ReminderDeps,
  target: ReminderTarget,
): Promise<boolean> {
  // PAID guard: trạng thái phải là dữ liệu TƯƠI đọc lúc gửi, không tin lịch hẹn.
  const order = await prisma.order.findUnique({
    where: { id: target.orderId },
    include: { product: true },
  });
  if (order === null || order.status !== "PENDING") {
    return false;
  }

  const conversation = await getOrCreateConversation(
    prisma,
    target.buyerId,
    target.shopId,
  );
  const row = await appendMessage(prisma, {
    conversationId: conversation.id,
    source: "SYSTEM",
    content: reminderContent(order),
    dedupKey: `order:${target.orderId}:remind`,
    orderId: target.orderId,
  });
  if (row === null) {
    return false; // đã nhắc đơn này rồi — dedup DB chặn, không phát lại socket
  }

  try {
    (deps.emit ?? registryEmit)(
      { message: toMessageEvent(row) },
      conversation.id,
      target.shopId,
    );
  } catch (error: unknown) {
    // Tin đã ở DB; lỗi socket không được làm chết nhánh gọi (timer/fire).
    console.error("[reminders] Lỗi phát sự kiện nhắc thanh toán:", error);
  }
  return true;
}

/**
 * Delay đọc LÚC GỌI (ruling R-P4): `deps.delayMs` (test) ▶ env
 * `PAYMENT_REMIND_DELAY_MS` (smoke Task 12 khỏi chờ 5 phút) ▶ hằng số 5 phút.
 * Env rác/âm/trắng → bỏ qua, về hằng số.
 */
function resolveDelayMs(depsDelayMs: number | undefined): number {
  if (depsDelayMs !== undefined) {
    return depsDelayMs;
  }
  const raw = process.env.PAYMENT_REMIND_DELAY_MS;
  if (raw !== undefined && raw.trim() !== "") {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed >= 0) {
      return parsed;
    }
  }
  return PAYMENT_REMIND_DELAY_MS;
}

/**
 * Hẹn nhắc thanh toán cho một đơn vừa chốt (hook sau khi tạo đơn thành công).
 * Hẹn lại cùng đơn chỉ giữ lịch MỚI NHẤT — dù vậy tin vẫn không thể nhân đôi vì
 * dedup DB là chốt chặn cuối. Trả về ngay; việc gửi chạy nền trong timer.
 */
export function schedulePaymentReminder(
  orderId: string,
  buyerId: string,
  shopId: string,
  deps: ReminderDeps = {},
): void {
  const store = reminderTimers();
  const existing = store.get(orderId);
  if (existing !== undefined) {
    clearTimeout(existing);
  }

  const timer = setTimeout(() => {
    // Fire là hết nhiệm vụ: xoá sổ trước khi làm việc để không giữ tham chiếu.
    store.delete(orderId);
    void deliverReminder(deps.prisma ?? appPrisma, deps, {
      orderId,
      buyerId,
      shopId,
    }).catch((error: unknown) => {
      console.error("[reminders] Lỗi gửi nhắc thanh toán:", error);
    });
  }, resolveDelayMs(deps.delayMs));

  // Best-effort: không giữ process sống chỉ vì một lịch nhắc (server vẫn sống
  // nhờ HTTP/socket; script ngắn hạn thoát sạch). Fake timer của test không có
  // `unref` → optional chaining là no-op.
  timer.unref?.();
  store.set(orderId, timer);
}

/**
 * Nhắc TOÀN BỘ đơn còn `PENDING` của một phiên (hook cuối `endLive`), trả về số
 * đơn thật sự vừa được nhắc (test khẳng định; gọi lại lần hai về 0 nhờ dedup).
 *
 * Dùng chung `deliverReminder` với timer nên mọi bất biến (PAID guard đọc tươi,
 * dedup một tin/đơn, emit một lần) giống hệt — end-live chỉ là lưới an toàn:
 * timer chưa nổ thì end-live nhắc, timer nổ sau đó thì dedup chặn.
 */
export async function remindPendingOrdersForSession(
  sessionId: string,
  deps: ReminderDeps = {},
): Promise<number> {
  const prisma = deps.prisma ?? appPrisma;
  const orders = await prisma.order.findMany({
    where: { liveSessionId: sessionId, status: "PENDING" },
    select: { id: true, buyerId: true, shopId: true },
    orderBy: { code: "asc" },
  });

  let reminded = 0;
  for (const order of orders) {
    const sent = await deliverReminder(prisma, deps, {
      orderId: order.id,
      buyerId: order.buyerId,
      shopId: order.shopId,
    });
    if (sent) {
      reminded += 1;
    }
  }
  return reminded;
}

/**
 * Huỷ lịch nhắc đang chờ của một đơn (không có gì → no-op). Test dùng để dọn
 * timer giữa các case; về sau Task trả tiền có thể gọi khi đơn được trả sớm.
 */
export function cancelPaymentReminder(orderId: string): void {
  const store = reminderTimers();
  const timer = store.get(orderId);
  if (timer !== undefined) {
    clearTimeout(timer);
    store.delete(orderId);
  }
}
