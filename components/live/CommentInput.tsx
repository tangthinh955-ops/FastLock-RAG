"use client";

import Link from "next/link";
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import type { LiveComment } from "@/hooks/useLiveSocket";

const MAX_COMMENT_LENGTH = 200;
/** Chống double-click: mở lại nút sau 3s kể cả khi gateway không kịp phản hồi. */
const SEND_TIMEOUT_MS = 3000;

type SendState = {
  /**
   * `seq` của comment mới nhất lúc bấm gửi — echo hợp lệ luôn có `seq` lớn hơn
   * mốc này, kể cả khi feed đã chạm trần 200 và bị cắt bớt phần đầu.
   */
  lastSeq: number;
  /** Nonce của lần gửi này; timeout chỉ được xoá đúng trạng thái của nó. */
  nonce: string;
};

type CommentInputProps = {
  comments: LiveComment[];
  userId: string;
  sessionId: string;
  sendComment: (text: string, nonce: string) => void;
  ended: boolean;
  anonymous: boolean;
};

/**
 * Ô nhập comment dưới cùng của màn xem live.
 *
 * Pending được suy ra từ `comments`, không cần setState trong effect:
 * - bấm Gửi → lưu mốc `lastSeq = seq của comment mới nhất` + `nonce`;
 * - khi có comment của CHÍNH mình hoặc comment system với `seq` lớn hơn mốc →
 *   coi như đã có phản hồi, nút mở lại ngay (dùng `seq` thay vì chỉ số mảng vì
 *   feed cắt bớt khi chạm trần 200 — `length` lúc đó không còn tăng);
 * - quá 3s không phản hồi → timeout xoá state, nút cũng mở lại.
 *
 * Khách ẩn danh không thấy form (không có socket); phiên ENDED thay form bằng
 * thông báo, đúng yêu cầu read-only.
 */
export default function CommentInput({
  comments,
  userId,
  sessionId,
  sendComment,
  ended,
  anonymous,
}: CommentInputProps) {
  const [text, setText] = useState("");
  const [sendState, setSendState] = useState<SendState | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timeoutRef.current !== null) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  if (ended) {
    return (
      <div className="rounded-xl border border-white/15 bg-black/45 px-4 py-3 text-sm text-white/75 backdrop-blur-sm">
        <strong className="font-semibold text-white">Live đã kết thúc.</strong>{" "}
        Phiên này không còn nhận comment hay đơn mới.
      </div>
    );
  }

  if (anonymous) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/15 bg-black/45 px-4 py-3 text-sm text-white/75 backdrop-blur-sm">
        <span>Đăng nhập để bình luận và chốt đơn cùng shop.</span>
        <Link
          href="/login"
          className="inline-flex items-center rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400"
        >
          Đăng nhập
        </Link>
      </div>
    );
  }

  const clearedByComment =
    sendState !== null &&
    comments.some(
      (comment) =>
        comment.seq > sendState.lastSeq &&
        (comment.userId === userId || comment.kind === "system"),
    );
  const pending = sendState !== null && !clearedByComment;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = text.trim();
    if (trimmed === "" || pending || ended || anonymous) {
      return;
    }

    const nonce = crypto.randomUUID();
    setSendState({
      lastSeq: comments[comments.length - 1]?.seq ?? 0,
      nonce,
    });
    if (timeoutRef.current !== null) {
      clearTimeout(timeoutRef.current);
    }
    timeoutRef.current = setTimeout(() => {
      setSendState((current) =>
        current !== null && current.nonce === nonce ? null : current,
      );
    }, SEND_TIMEOUT_MS);

    sendComment(trimmed, nonce);
    setText("");
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <label htmlFor={`live-comment-${sessionId}`} className="sr-only">
          Bình luận trong live
        </label>
        <input
          id={`live-comment-${sessionId}`}
          type="text"
          value={text}
          onChange={(event) => setText(event.target.value)}
          maxLength={MAX_COMMENT_LENGTH}
          disabled={pending}
          placeholder={'Gõ "SP01 2 cái" để chốt đơn'}
          className="min-w-0 flex-1 rounded-xl border border-white/25 bg-white/10 px-3.5 py-2.5 text-sm text-white placeholder:text-white/45 outline-none backdrop-blur-sm transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/40 disabled:cursor-not-allowed disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={pending || text.trim() === ""}
          className="shrink-0 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400 disabled:cursor-not-allowed disabled:opacity-55"
        >
          {pending ? "Đang gửi…" : "Gửi"}
        </button>
      </div>
      <div className="flex items-center justify-between gap-3 px-0.5 text-[11px] text-white/45">
        <span>Mỗi comment chốt một mã SKU, tối đa 2 chữ số số lượng.</span>
        <span className="tabular-nums">
          {text.length}/{MAX_COMMENT_LENGTH}
        </span>
      </div>
    </form>
  );
}
