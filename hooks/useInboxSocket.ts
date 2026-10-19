"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import type {
  InboxAiThinkingEvent,
  InboxClientToServerEvents,
  InboxConversationEvent,
  InboxErrorEvent,
  InboxMessageEvent,
  InboxServerToClientEvents,
} from "@/lib/chat/gateway";

/**
 * Hook socket cho Inbox khách (Task 9) — một kết nối tới namespace `/inbox`
 * với JWT trong `auth.token`, join lại hội thoại đang mở sau mỗi reconnect.
 *
 * Cùng khuôn với `useLiveSocket` (Plan 1):
 * - `token = null` ⇒ KHÔNG mở socket (state rỗng, mọi hàm emit thành no-op).
 *   Trang `/inbox` luôn có token, nhưng giữ đúng hợp đồng "danh tính chỉ từ
 *   JWT" và để hook tái dùng được ở ngữ cảnh chưa chắc đăng nhập.
 * - State sống kèm `conversationId`; khi seed đổi sang hội thoại khác, giá trị
 *   dẫn xuất tự trả về rỗng trong CÙNG lần render (không reset bằng effect —
 *   luật `react-hooks/set-state-in-effect` của React Compiler cấm).
 * - Chỉ import TYPE từ `lib/chat/gateway.ts`: file đó kéo theo module server
 *   (Prisma, socket.io server); `import type` bị xoá lúc biên dịch nên bundle
 *   client không chạm tới runtime của gateway.
 *
 * `seed` (messages + mode/version) đến từ server component. Hợp đồng đổi hội
 * thoại: trang render `key={active.id}` quanh client component, nên mỗi hội
 * thoại là một vòng đời hook riêng — state không bao giờ trộn giữa hai hội
 * thoại; đổi qua lại vẫn dựng lại từ props server mới.
 *
 * Chống trùng phía người gửi: gateway phát `message` cho MỌI thành viên phòng
 * (kể cả người gửi), nên hook khử theo `message.id` — tin của chính mình chỉ
 * render một lần, không cần optimistic append.
 */

export type InboxChatMode = InboxConversationEvent["mode"];

/** Tin từ server (props/`message` event) — shape y hệt `toMessageEvent`. */
export type InboxSeedMessage = InboxMessageEvent["message"];

/**
 * Tin trong state client: kèm `seq` do client tự sinh.
 *
 * `seq` KHÔNG gửi qua socket — nó là tín hiệu "có tin mới" cho auto-scroll khi
 * danh sách chạm trần `MAX_MESSAGES` (lúc đó `length` ngừng tăng) — bài học
 * Plan 1 Task 14.
 */
export type InboxMessage = InboxSeedMessage & { seq: number };

/** Hợp đồng seed từ server: hội thoại đang mở + mode/version ban đầu. */
export type InboxSeed = {
  id: string;
  mode: InboxChatMode;
  version: number;
  messages: readonly InboxSeedMessage[];
};

type ChatState = {
  /** Hội thoại mà toàn bộ dữ liệu bên dưới thuộc về — khoá reset "miễn phí". */
  conversationId: string;
  messages: InboxMessage[];
  mode: InboxChatMode;
  version: number;
  aiThinking: boolean;
};

type InboxClientSocket = Socket<
  InboxServerToClientEvents,
  InboxClientToServerEvents
>;

/** Demo không cần lịch sử vô hạn — giữ cửa sổ tin gần nhất. */
const MAX_MESSAGES = 200;
/** Lỗi `inbox_error` tự tắt sau ~4s để không che khung chat. */
const ERROR_CLEAR_MS = 4000;

const EMPTY_MESSAGES: InboxMessage[] = [];

/** State ban đầu của một hội thoại từ seed server; seq đánh theo thứ tự. */
function seedChat(seed: InboxSeed): ChatState {
  return {
    conversationId: seed.id,
    messages: seed.messages.map((message, index) => ({
      ...message,
      seq: index + 1,
    })),
    mode: seed.mode,
    version: seed.version,
    aiThinking: false,
  };
}

/** Nối một tin mới; trùng `id` (echo tin của chính người gửi) thì giữ nguyên. */
function appendMessage(state: ChatState, event: InboxMessageEvent["message"]): ChatState {
  if (state.messages.some((message) => message.id === event.id)) {
    return state;
  }
  const lastSeq = state.messages[state.messages.length - 1]?.seq ?? 0;
  const messages = [...state.messages, { ...event, seq: lastSeq + 1 }];
  return {
    ...state,
    messages:
      messages.length > MAX_MESSAGES
        ? messages.slice(messages.length - MAX_MESSAGES)
        : messages,
  };
}

export type UseInboxSocketResult = {
  messages: InboxMessage[];
  mode: InboxChatMode;
  /** Từ `conversation_updated` (takeover/trả-AI); khởi tạo từ seed server. */
  version: number;
  aiThinking: boolean;
  /** Lỗi từ `inbox_error` — hiện banner nhỏ rồi tự xoá (~4s). */
  error: string | null;
  connected: boolean;
  /** Gửi tin BUYER với `clientNonce` sinh mới mỗi lần; echo về qua `message`. */
  sendMessage: (content: string) => void;
};

export function useInboxSocket(
  token: string | null,
  seed: InboxSeed | null,
): UseInboxSocketResult {
  const [chat, setChat] = useState<ChatState | null>(() =>
    seed === null ? null : seedChat(seed),
  );
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const socketRef = useRef<InboxClientSocket | null>(null);
  const seedRef = useRef<InboxSeed | null>(seed);
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Đồng bộ ref sau commit — event handler đọc ref để không đóng gói seed cũ
  // vào closure của socket (socket sống lâu hơn một lần render).
  useEffect(() => {
    seedRef.current = seed;
  }, [seed]);

  // Kết nối đúng MỘT lần cho mỗi token (đổi hội thoại = remount, không dựng
  // socket mới ở đây). StrictMode dev chạy setup → cleanup → setup: cleanup
  // disconnect hẳn socket cũ trước khi socket mới được tạo.
  useEffect(() => {
    if (token === null) {
      return;
    }

    const socket: InboxClientSocket = io("/inbox", {
      // Cùng origin + path mặc định: custom server `server.ts` phục vụ cả trang
      // lẫn socket, không hard-code host/port.
      auth: { token },
    });
    socketRef.current = socket;

    const handleConnect = () => setConnected(true);
    const handleDisconnect = () => setConnected(false);
    const handleConnectError = () => setConnected(false);

    const handleMessage = (event: InboxMessageEvent) => {
      const current = seedRef.current;
      if (current === null || event.message.conversationId !== current.id) {
        return;
      }
      setChat((previous) =>
        previous !== null && previous.conversationId === current.id
          ? appendMessage(previous, event.message)
          : appendMessage(seedChat(current), event.message),
      );
    };

    const handleConversationUpdated = (event: InboxConversationEvent) => {
      const current = seedRef.current;
      if (current === null || event.conversationId !== current.id) {
        return;
      }
      setChat((previous) => {
        const base =
          previous !== null && previous.conversationId === current.id
            ? previous
            : seedChat(current);
        return { ...base, mode: event.mode, version: event.version };
      });
    };

    const handleAiThinking = (event: InboxAiThinkingEvent) => {
      const current = seedRef.current;
      if (current === null || event.conversationId !== current.id) {
        return;
      }
      setChat((previous) => {
        const base =
          previous !== null && previous.conversationId === current.id
            ? previous
            : seedChat(current);
        return { ...base, aiThinking: event.thinking };
      });
    };

    const handleError = (event: InboxErrorEvent) => {
      const current = seedRef.current;
      // Lỗi gắn hội thoại khác (phòng cũ còn giữ) không hiện ở hội thoại đang
      // mở; lỗi không gắn hội thoại (payload sai…) thì luôn hiện.
      if (
        event.conversationId !== undefined &&
        (current === null || event.conversationId !== current.id)
      ) {
        return;
      }
      setError(event.message);
      if (errorTimerRef.current !== null) {
        clearTimeout(errorTimerRef.current);
      }
      errorTimerRef.current = setTimeout(() => setError(null), ERROR_CLEAR_MS);
    };

    socket.on("connect", handleConnect);
    socket.on("disconnect", handleDisconnect);
    socket.on("connect_error", handleConnectError);
    socket.on("message", handleMessage);
    socket.on("conversation_updated", handleConversationUpdated);
    socket.on("ai_thinking", handleAiThinking);
    socket.on("inbox_error", handleError);

    return () => {
      socket.off("connect", handleConnect);
      socket.off("disconnect", handleDisconnect);
      socket.off("connect_error", handleConnectError);
      socket.off("message", handleMessage);
      socket.off("conversation_updated", handleConversationUpdated);
      socket.off("ai_thinking", handleAiThinking);
      socket.off("inbox_error", handleError);
      socket.disconnect();
      socketRef.current = null;
      if (errorTimerRef.current !== null) {
        clearTimeout(errorTimerRef.current);
        errorTimerRef.current = null;
      }
    };
  }, [token]);

  // Join khi đã connected và mỗi lần reconnect (connected false → true). Join
  // lại một hội thoại đã trong phòng là no-op phía server (socket.io dedupe).
  const seedId = seed?.id ?? null;
  useEffect(() => {
    if (!connected || seedId === null) {
      return;
    }
    socketRef.current?.emit("join_conversation", { conversationId: seedId });
  }, [connected, seedId]);

  const sendMessage = useCallback((content: string) => {
    const socket = socketRef.current;
    const current = seedRef.current;
    if (socket === null || current === null) {
      return;
    }
    socket.emit("send_message", {
      conversationId: current.id,
      content,
      // Nonce chống trùng phía server: dedupKey = msg:{conversationId}:{nonce}.
      clientNonce: crypto.randomUUID(),
    });
  }, []);

  const activeChat =
    chat !== null && seed !== null && chat.conversationId === seed.id
      ? chat
      : null;

  return {
    messages: activeChat?.messages ?? EMPTY_MESSAGES,
    mode: activeChat?.mode ?? seed?.mode ?? "AI",
    version: activeChat?.version ?? seed?.version ?? 0,
    aiThinking: activeChat?.aiThinking ?? false,
    error,
    // Token null ⇒ không có socket: `connected` cũ (nếu có) không được rò ra UI.
    connected: token !== null && connected,
    sendMessage,
  };
}
