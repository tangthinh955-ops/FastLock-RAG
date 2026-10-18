"use client";

import { useEffect, useRef, type ReactNode } from "react";
import type { LiveComment } from "@/hooks/useLiveSocket";

const msFormatter = new Intl.NumberFormat("vi-VN", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

/** "0,4" — dấu thập phân kiểu Việt; số luôn lấy từ `elapsedMs` thật. */
function formatMs(value: number): string {
  return msFormatter.format(value);
}

/**
 * Tách text thành các đoạn thường / đoạn SKU được bắt, dùng đúng toạ độ UTF-16
 * của `matches` trên chính chuỗi gateway đã phát (SĐT đã che từ server).
 *
 * Chống overlap: sort theo `start` rồi bỏ mọi match bắt đầu trước con trỏ đã
 * vẽ. Nhờ vậy hai match chồng nhau không nhân đôi ký tự và không lệch text.
 * Match sai biên (dữ liệu lạ) cũng bị bỏ qua thay vì cắt chuỗi ngoài phạm vi.
 */
function renderHighlighted(text: string, matches: LiveComment["matches"]): ReactNode {
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
      continue; // match chồng lấn — đoạn này đã được tô bởi match trước
    }
    if (match.start > cursor) {
      parts.push(text.slice(cursor, match.start));
    }
    parts.push(
      <mark
        key={`${match.start}-${match.end}`}
        className="rounded-sm bg-amber-300 px-0.5 font-bold text-zinc-950 dark:bg-amber-400"
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

export default function LiveCommentFeed({
  comments,
}: {
  comments: LiveComment[];
}) {
  const listRef = useRef<HTMLDivElement | null>(null);
  // `length` dừng tăng khi feed chạm trần 200 → dùng `seq` để vẫn auto-scroll.
  const newestSeq = comments[comments.length - 1]?.seq ?? 0;

  // Cuộn trong đúng khung feed, không dùng scrollIntoView để tránh kéo cả trang.
  useEffect(() => {
    const list = listRef.current;
    if (list !== null) {
      list.scrollTop = list.scrollHeight;
    }
  }, [newestSeq]);

  return (
    <section className="flex max-h-[520px] min-h-[300px] flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm lg:max-h-none lg:min-h-0 dark:border-zinc-800 dark:bg-zinc-950">
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <h2 className="text-sm font-semibold tracking-tight">
          💬 Comment realtime
        </h2>
        <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-500 tabular-nums dark:bg-zinc-800 dark:text-zinc-400">
          {comments.length}
        </span>
      </header>

      <div
        ref={listRef}
        className="flex-1 space-y-2.5 overflow-y-auto px-4 py-3"
        aria-live="polite"
        aria-relevant="additions"
      >
        {comments.length === 0 ? (
          <p className="grid h-full place-items-center px-4 text-center text-sm text-zinc-500 dark:text-zinc-400">
            Chưa có comment — khách gõ mã SP trong comment để chốt đơn.
          </p>
        ) : (
          comments.map((comment, index) => {
            if (comment.kind === "system") {
              const outOfStock = comment.text.toLowerCase().includes("hết hàng");
              return (
                <div key={`${comment.createdAt}-${index}`} className="px-0.5">
                  <p
                    className={`text-sm font-medium ${
                      outOfStock
                        ? "text-amber-700 dark:text-amber-400"
                        : "text-emerald-700 dark:text-emerald-400"
                    }`}
                  >
                    <span aria-hidden>{outOfStock ? "⚠️" : "⚡"}</span>{" "}
                    {comment.text}
                  </p>
                </div>
              );
            }

            const hasMatch = comment.matches.length > 0;
            const hasOrder =
              comment.orderCode !== undefined &&
              typeof comment.elapsedMs === "number";

            return (
              <div
                key={`${comment.createdAt}-${index}`}
                className={
                  hasMatch
                    ? "rounded-xl bg-amber-50 px-3 py-2 ring-1 ring-amber-200/80 dark:bg-amber-950/25 dark:ring-amber-800/50"
                    : "px-0.5 py-0.5"
                }
              >
                <p className="text-sm leading-relaxed break-words text-zinc-800 dark:text-zinc-200">
                  <span className="font-semibold text-emerald-700 dark:text-emerald-400">
                    {comment.userName}:
                  </span>{" "}
                  {renderHighlighted(comment.text, comment.matches)}
                </p>

                {hasOrder && (
                  <p className="mt-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                    ⚡ Bắt SKU {formatMs(comment.elapsedMs as number)} ms → tạo
                    Đơn #{comment.orderCode}
                  </p>
                )}
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}
