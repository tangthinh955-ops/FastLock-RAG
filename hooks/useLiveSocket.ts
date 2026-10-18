"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import type {
  CommentEvent,
  LiveClientToServerEvents,
  LiveEndedEvent,
  LiveServerToClientEvents,
  NewOrderEvent,
  ViewersEvent,
} from "@/lib/live/gateway";

/**
 * Hook socket dùng chung cho Studio (Task 13) và màn xem live (Task 14): một
 * kết nối duy nhất tới namespace `/live` với JWT trong `auth.token`, tự join
 * lại sau reconnect và đổi phòng khi `sessionId` đổi.
 *
 * `token = null` (khách chưa đăng nhập, hoặc phiên đã ENDED) ⇒ KHÔNG mở socket:
 * state trả về rỗng và mọi hàm emit thành no-op, nhờ vậy viewer ẩn danh xem
 * stage read-only mà không nhận `connect_error` "unauthorized".
 *
 * Vì sao state gói theo `sessionId` thay vì reset bằng effect:
 * - Cách "chuẩn" `useEffect(() => setComments([]), [sessionId])` tạo thêm một
 *   vòng render và có khoảnh khắc UI hiện dữ liệu phiên cũ dưới tiêu đề phiên
 *   mới. Ở đây state giữ kèm `sessionId`; khi phiên đổi, giá trị dẫn xuất tự
 *   trả về rỗng ngay trong cùng lần render, không cần effect reset.
 * - Luật React Compiler của Next 16 (`react-hooks/set-state-in-effect`) cũng
 *   không cho setState đồng bộ trong effect.
 *
 * Chỉ import TYPE từ `lib/live/gateway.ts`: file đó kéo theo module server
 * (Prisma, node:crypto); `import type` bị xoá lúc biên dịch nên client bundle
 * không bao giờ chạm tới runtime của gateway.
 */

/**
 * Comment kèm mã đơn gắn thêm khi `new_order` tương ứng về ngay sau đó, và
 * `seq` — số thứ tự tăng dần do client tự sinh.
 *
 * `seq` KHÔNG gửi qua socket. Nó tồn tại vì feed cắt bớt khi chạm trần
 * `MAX_COMMENTS`: lúc đó `length` dừng tăng nên không còn dùng làm mốc
 * "comment mới hơn" (CommentInput) hay tín hiệu auto-scroll được nữa.
 */
export type LiveComment = CommentEvent & { orderCode?: number; seq: number };

/**
 * Nguồn duy nhất sinh `seq`: bộ đếm toàn cục phía client. Chỉ cần tăng
 * nghiêm ngặt — nhảy số (StrictMode gọi updater hai lần ở dev) vô hại.
 */
let commentSeq = 0;

function nextCommentSeq(): number {
  commentSeq += 1;
  return commentSeq;
}

/** Đơn nổ kèm tên người mua do gateway phát. */
export type LiveOrder = NewOrderEvent;

type LiveClientSocket = Socket<
  LiveServerToClientEvents,
  LiveClientToServerEvents
>;

/** Feed chỉ cần giữ một cửa sổ gần nhất — demo không cần lịch sử vô hạn. */
const MAX_COMMENTS = 200;
const MAX_ORDERS = 50;

const EMPTY_COMMENTS: LiveComment[] = [];
const EMPTY_ORDERS: LiveOrder[] = [];

type FeedState = {
  /** Phiên mà dữ liệu bên dưới thuộc về — chìa khoá để reset "miễn phí". */
  sessionId: string;
  comments: LiveComment[];
  orders: LiveOrder[];
  viewers: number | null;
};

function appendComment(
  previous: FeedState | null,
  sessionId: string,
  event: CommentEvent,
): FeedState {
  const comment: LiveComment = { ...event, seq: nextCommentSeq() };

  if (previous === null || previous.sessionId !== sessionId) {
    return { sessionId, comments: [comment], orders: [], viewers: null };
  }

  const comments = [...previous.comments, comment];
  return {
    ...previous,
    comments:
      comments.length > MAX_COMMENTS
        ? comments.slice(comments.length - MAX_COMMENTS)
        : comments,
  };
}

/**
 * Gắn `orderCode` vào comment GẦN NHẤT của đúng người mua có bắt được SKU.
 *
 * Gateway phát `comment` TRƯỚC `new_order` trong cùng một lượt xử lý, nên khi
 * `new_order` tới, comment tương ứng đã nằm cuối danh sách. Điều kiện
 * `matches.length > 0` loại comment fake/chat thường; `orderCode === undefined`
 * bảo đảm mỗi comment chỉ nhận một dòng "tạo Đơn" (gửi lại cùng nonce không
 * phát thêm `new_order`, nên không có lần gắn thứ hai).
 */
function attachOrderCode(
  comments: LiveComment[],
  buyerId: string,
  orderCode: number,
): LiveComment[] {
  for (let index = comments.length - 1; index >= 0; index -= 1) {
    const comment = comments[index];
    if (
      comment.userId === buyerId &&
      comment.matches.length > 0 &&
      comment.orderCode === undefined
    ) {
      const next = [...comments];
      next[index] = { ...comment, orderCode };
      return next;
    }
  }
  return comments;
}

function addOrder(
  previous: FeedState | null,
  sessionId: string,
  event: NewOrderEvent,
): FeedState {
  if (previous === null || previous.sessionId !== sessionId) {
    // Hiếm: comment và new_order lọt qua khe đổi phiên — vẫn giữ đơn, không bịa comment.
    return {
      sessionId,
      comments: [],
      orders: [event],
      viewers: null,
    };
  }

  return {
    ...previous,
    orders: [event, ...previous.orders].slice(0, MAX_ORDERS),
    comments: attachOrderCode(
      previous.comments,
      event.buyerId,
      event.order.code,
    ),
  };
}

function updateViewers(
  previous: FeedState | null,
  sessionId: string,
  count: number,
): FeedState {
  if (previous === null || previous.sessionId !== sessionId) {
    return { sessionId, comments: [], orders: [], viewers: count };
  }
  return { ...previous, viewers: count };
}

export type UseLiveSocketResult = {
  comments: LiveComment[];
  orders: LiveOrder[];
  /** `null` cho tới tick giả lập đầu tiên (gateway không có snapshot cho join muộn). */
  viewers: number | null;
  /** Phiên hiện tại đã kết thúc (kể cả khi join bị từ chối vì không còn LIVE). */
  ended: boolean;
  connected: boolean;
  /** Bật/tắt giả lập khách — không có ack, UI cập nhật lạc quan. */
  toggleFake: (enabled: boolean) => void;
  /** Gửi comment của viewer; `nonce` do caller sinh để chống trùng phía server. */
  sendComment: (text: string, nonce: string) => void;
};

export function useLiveSocket(
  token: string | null,
  sessionId: string | null,
): UseLiveSocketResult {
  const [feed, setFeed] = useState<FeedState | null>(null);
  const [endedSessionId, setEndedSessionId] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);

  const socketRef = useRef<LiveClientSocket | null>(null);
  const sessionIdRef = useRef<string | null>(null);

  // Đồng bộ ref sau commit — event handler luôn đọc ref để không đóng gói
  // sessionId cũ vào closure của socket (socket sống lâu hơn một phiên).
  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  // Kết nối đúng MỘT lần cho mỗi token. Đổi phiên không dựng socket mới.
  // StrictMode dev chạy setup → cleanup → setup: cleanup disconnect hẳn socket
  // cũ trước khi socket mới được tạo, không có hai kết nối song song.
  // Token null = viewer ẩn danh/phiên đã ENDED: không mở kết nối nào.
  useEffect(() => {
    if (token === null) {
      return;
    }

    const socket: LiveClientSocket = io("/live", {
      // Cùng origin + path mặc định: custom server `server.ts` phục vụ cả
      // trang lẫn socket, không hard-code host/port.
      auth: { token },
    });
    socketRef.current = socket;

    const handleConnect = () => setConnected(true);
    const handleDisconnect = () => setConnected(false);
    const handleConnectError = () => setConnected(false);

    const handleComment = (event: CommentEvent) => {
      const current = sessionIdRef.current;
      if (current === null) return;
      setFeed((previous) => appendComment(previous, current, event));
    };

    const handleNewOrder = (event: NewOrderEvent) => {
      const current = sessionIdRef.current;
      if (current === null) return;
      setFeed((previous) => addOrder(previous, current, event));
    };

    const handleViewers = (event: ViewersEvent) => {
      const current = sessionIdRef.current;
      if (current === null) return;
      setFeed((previous) => updateViewers(previous, current, event.count));
    };

    const handleLiveEnded = (event: LiveEndedEvent) => {
      if (event.sessionId === sessionIdRef.current) {
        setEndedSessionId(event.sessionId);
      }
    };

    socket.on("connect", handleConnect);
    socket.on("disconnect", handleDisconnect);
    socket.on("connect_error", handleConnectError);
    socket.on("comment", handleComment);
    socket.on("new_order", handleNewOrder);
    socket.on("viewers", handleViewers);
    socket.on("live_ended", handleLiveEnded);

    return () => {
      socket.off("connect", handleConnect);
      socket.off("disconnect", handleDisconnect);
      socket.off("connect_error", handleConnectError);
      socket.off("comment", handleComment);
      socket.off("new_order", handleNewOrder);
      socket.off("viewers", handleViewers);
      socket.off("live_ended", handleLiveEnded);
      socket.disconnect();
      socketRef.current = null;
    };
  }, [token]);

  // Join khi đã connected và mỗi lần reconnect (connected false → true).
  // Cùng phiên thì không reset gì; đổi phiên thì dữ liệu dẫn xuất tự rỗng.
  useEffect(() => {
    if (!connected || sessionId === null) return;
    socketRef.current?.emit("join_live", { sessionId });
  }, [connected, sessionId]);

  const toggleFake = useCallback((enabled: boolean) => {
    const socket = socketRef.current;
    const current = sessionIdRef.current;
    if (socket === null || current === null) return;
    socket.emit("toggle_fake", { sessionId: current, enabled });
  }, []);

  const sendComment = useCallback((text: string, nonce: string) => {
    const socket = socketRef.current;
    const current = sessionIdRef.current;
    if (socket === null || current === null) return;
    socket.emit("send_comment", { sessionId: current, text, nonce });
  }, []);

  const activeFeed =
    feed !== null && feed.sessionId === sessionId ? feed : null;

  return {
    comments: activeFeed?.comments ?? EMPTY_COMMENTS,
    orders: activeFeed?.orders ?? EMPTY_ORDERS,
    viewers: activeFeed?.viewers ?? null,
    // Token null ⇒ không có socket: `connected` cũ (nếu có) không được rò ra UI.
    ended: sessionId !== null && endedSessionId === sessionId,
    connected: token !== null && connected,
    toggleFake,
    sendComment,
  };
}
