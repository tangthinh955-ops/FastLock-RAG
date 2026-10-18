"use client";

import Link from "next/link";
import { useEffect, useRef, type ReactNode } from "react";
import type { LiveComment } from "@/hooks/useLiveSocket";

const msFormatter = new Intl.NumberFormat("vi-VN", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

/** "0,4" — dấu thập phân kiểu Việt; số luôn lấy từ `elapsedMs` thật của gateway. */
function formatMs(value: number): string {
  return msFormatter.format(value);
}

/**
 * Tách text thành đoạn thường / đoạn SKU khớp, dùng đúng toạ độ UTF-16 mà
 * gateway tính trên chính chuỗi đã phát (SĐT đã được che server-side).
 *
 * Cùng thuật toán với feed Studio: sort theo `start`, bỏ match chồng lấn hoặc
 * sai biên để không cắt lệch chuỗi.
 */
function renderHighlighted(
  text: string,
  matches: LiveComment["matches"],
): ReactNode {
  if (matches.length === 0) {
    return text;
  }

  const ordered = [...matches]
    .filter(
      (match) =>
        Number.isInteger(match.start) &&
        Number.isInteger(match.end) &&
        match.start >= 0 &&
        match.end > match.start &&
        match.end <= text.length,
    )
    .sort((a, b) => a.start - b.start || a.end - b.end);

  if (ordered.length === 0) {
    return text;
  }

  const parts: ReactNode[] = [];
  let cursor = 0;

  for (const match of ordered) {
    if (match.start < cursor) {
      continue;
    }
    if (match.start > cursor) {
      parts.push(text.slice(cursor, match.start));
    }
    parts.push(
      <mark
        key={`${match.start}-${match.end}`}
        className="rounded-sm bg-amber-300 px-0.5 font-bold text-zinc-950"
      >
        {text.slice(match.start, match.end)}
      </mark>,
    );
    cursor = match.end;
  }

  if (cursor < text.length) {
    parts.push(text.slice(cursor));
  }

  return parts;
}

type ChatOverlayProps = {
  comments: LiveComment[];
  /** Khách chưa đăng nhập: không có socket, chỉ hiện lời mời đăng nhập. */
  anonymous: boolean;
  /** Phiên đã kết thúc — đổi câu empty state khi chưa có comment nào. */
  ended?: boolean;
};

/**
 * Chat nổi trên "video" theo mockup Option B (TikTok): bong bóng tối, tên
 * người gửi xanh nhạt, SKU khớp tô vàng, dòng hệ thống xanh khi tạo đơn và
 * amber cho cảnh báo (hết hàng, tin không hợp lệ).
 *
 * `orderCode` do hook gắn vào comment ngay khi `new_order` tương ứng về; nhờ
 * vậy dòng "⚡ Bắt SKU … → tạo Đơn #…" luôn dùng đúng `elapsedMs` của lần bắt
 * SKU đó, không hard-code số.
 */
export default function ChatOverlay({
  comments,
  anonymous,
  ended = false,
}: ChatOverlayProps) {
  const listRef = useRef<HTMLDivElement | null>(null);
  // `length` dừng tăng khi feed chạm trần 200 → dùng `seq` để vẫn auto-scroll.
  const newestSeq = comments[comments.length - 1]?.seq ?? 0;

  // Cuộn trong đúng khung chat, không dùng scrollIntoView để tránh kéo trang.
  useEffect(() => {
    const list = listRef.current;
    if (list !== null) {
      list.scrollTop = list.scrollHeight;
    }
  }, [newestSeq]);

  if (anonymous) {
    return (
      <div className="rounded-2xl border border-white/15 bg-black/55 px-4 py-3 text-sm text-white shadow-lg backdrop-blur-sm">
        <p className="font-medium">Đăng nhập để xem chat trực tiếp</p>
        <p className="mt-1 text-xs text-white/65">
          Khách vẫn xem được sân khấu live, nhưng cần tài khoản để đọc comment
          và chốt đơn.
        </p>
        <Link
          href="/login"
          className="mt-2.5 inline-flex items-center rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400"
        >
          Đăng nhập ngay
        </Link>
      </div>
    );
  }

  return (
    <div
      ref={listRef}
      aria-live="polite"
      aria-relevant="additions"
      className="max-h-[42vh] space-y-2 overflow-y-auto pr-1 lg:max-h-[52vh]"
    >
      {comments.length === 0 ? (
        <p className="rounded-xl bg-black/40 px-3 py-2 text-xs text-white/60">
          {ended
            ? "Live đã kết thúc — không còn bình luận mới."
            : "Chưa có comment — gõ mã SP trong ô bên dưới để chốt đơn."}
        </p>
      ) : (
        comments.map((comment, index) => {
          if (comment.kind === "system") {
            return (
              <p
                key={`${comment.createdAt}-${index}`}
                className="w-fit rounded-lg bg-black/45 px-2.5 py-1.5 text-xs font-semibold text-amber-300 backdrop-blur-sm"
              >
                <span aria-hidden>⚠️</span> {comment.text}
              </p>
            );
          }

          const hasMatch = comment.matches.length > 0;
          const hasOrder =
            comment.orderCode !== undefined &&
            typeof comment.elapsedMs === "number";

          return (
            <div
              key={`${comment.createdAt}-${index}`}
              className={`w-fit max-w-full rounded-2xl bg-black/55 px-3 py-2 text-sm text-white shadow-sm backdrop-blur-sm ring-1 ${
                hasMatch ? "ring-amber-300/60" : "ring-white/10"
              }`}
            >
              <p className="leading-relaxed break-words">
                <span className="font-semibold text-sky-300">
                  {comment.userName}:
                </span>{" "}
                {renderHighlighted(comment.text, comment.matches)}
              </p>

              {hasOrder && (
                <p className="mt-1 text-xs font-semibold text-emerald-300 drop-shadow-sm">
                  ⚡ Bắt SKU {formatMs(comment.elapsedMs as number)} ms → tạo Đơn
                  #{comment.orderCode}
                </p>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
