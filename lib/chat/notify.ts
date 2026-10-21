import type { Namespace } from "socket.io";
import type { InboxMessageEvent } from "./flow";
import {
  conversationRoom,
  getInboxIo,
  INBOX_NAMESPACE,
  shopInboxRoom,
} from "../socket-registry";

/**
 * Phát tin Inbox từ REST (Plan 3 T1 tách từ `lib/chat/reminders.ts`): socket
 * server lấy từ registry (`getInboxIo`, R18) và phát vào đúng hai phòng như
 * `createInboxEmitter` — `conversation:{id}` (buyer + seller đang mở) và
 * `shop:{shopId}` (mọi phiên seller của shop).
 *
 * Không có io (CLI, test) → bỏ qua im lặng: tin đã nằm trong DB, UI nạp lại
 * vẫn thấy. Service không tự phát socket — route handler gọi hàm này sau khi
 * service trả về, nhờ vậy test service chạy offline.
 */

/** Event map tối thiểu của namespace `/inbox` cho một chỗ ép type khi phát. */
type InboxEmitEvents = { message: (event: InboxMessageEvent) => void };

export function emitInboxMessage(
  event: InboxMessageEvent["message"],
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
    .emit("message", { message: event });
}
