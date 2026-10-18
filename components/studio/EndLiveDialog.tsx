"use client";

import { useEffect, useRef, useState } from "react";

const priceFormatter = new Intl.NumberFormat("vi-VN", {
  maximumFractionDigits: 0,
});

function formatVnd(value: number): string {
  return `${priceFormatter.format(value)}đ`;
}

export type LiveEndSummary = {
  orderCount: number;
  paidRevenue: number;
};

/**
 * Popup tổng kết nhanh sau khi kết thúc live (spec §5.5, mockup screen-05).
 * Số liệu lấy nguyên từ response `POST /api/seller/live/end`:
 * `orderCount` = mọi đơn thuộc phiên, `paidRevenue` = tổng đơn đã thu tiền.
 *
 * Nút Dashboard bị disable có chủ đích — `/seller` thuộc Plan 3; ghi rõ "Plan 3"
 * để người xem demo không tưởng là lỗi.
 */
export default function EndLiveDialog({
  summary,
  onClose,
}: {
  summary: LiveEndSummary;
  onClose: () => void;
}) {
  const overlayRef = useRef<HTMLDivElement | null>(null);
  /**
   * Phần tử đang focus ngay trước khi dialog xuất hiện, để trả focus về khi
   * đóng (a11y). Ghi trong initializer thay vì trong effect: `autoFocus` của
   * nút "Đóng" đã chạy trong lúc commit nên effect sẽ bắt nhầm chính nút đó.
   */
  const [previouslyFocused] = useState<HTMLElement | null>(() =>
    typeof document === "undefined"
      ? null
      : (document.activeElement as HTMLElement | null),
  );

  useEffect(() => {
    // Chụp DOM node ngay lúc effect chạy; cleanup đọc biến này để biết dialog
    // đã thực sự rời DOM chưa (StrictMode dev chạy cleanup mô phỏng khi node
    // vẫn còn — lúc đó không được cướp focus khỏi nút "Đóng").
    const overlay = overlayRef.current;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      const dialogGone = overlay === null || !overlay.isConnected;
      if (dialogGone) {
        // Nút "■ Kết thúc live" bị tháo ngay khi dialog mở (`showLiveStage`
        // chuyển false) nên `previouslyFocused` thường đã mất — fallback về ô
        // tiêu đề của form "Bắt đầu live" (đích focus hợp lý cho hành động
        // tiếp theo, và luôn tồn tại sau khi dialog đóng).
        const fallback = document.getElementById("studio-live-title");
        const target =
          previouslyFocused !== null && previouslyFocused.isConnected
            ? previouslyFocused
            : fallback;
        target?.focus();
      }
    };
  }, [onClose, previouslyFocused]);

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/70 p-4 backdrop-blur-sm"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="end-live-title"
        aria-describedby="end-live-description"
        className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-6 shadow-2xl dark:border-zinc-700 dark:bg-zinc-900"
      >
        <p className="text-4xl" aria-hidden>
          🎉
        </p>
        <h2
          id="end-live-title"
          className="mt-3 text-2xl font-semibold tracking-tight"
        >
          Live đã kết thúc
        </h2>
        <p
          id="end-live-description"
          className="mt-1 text-sm text-zinc-600 dark:text-zinc-400"
        >
          Phiên live của bạn đã xuống sóng. Đây là tổng kết nhanh:
        </p>

        <dl className="mt-5 grid grid-cols-2 gap-3">
          <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 dark:border-zinc-700 dark:bg-zinc-950">
            <dt className="text-xs font-medium tracking-wide text-zinc-500 uppercase dark:text-zinc-400">
              Đơn đã chốt
            </dt>
            <dd className="mt-1 text-3xl font-bold tracking-tight tabular-nums">
              {summary.orderCount}
            </dd>
          </div>
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 dark:border-emerald-900 dark:bg-emerald-950/40">
            <dt className="text-xs font-medium tracking-wide text-emerald-700 uppercase dark:text-emerald-400">
              Doanh thu đã thu
            </dt>
            <dd className="mt-1 text-2xl font-bold tracking-tight text-emerald-800 tabular-nums dark:text-emerald-300">
              {formatVnd(summary.paidRevenue)}
            </dd>
          </div>
        </dl>

        <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
          Doanh thu chỉ tính các đơn đã thanh toán (PAID/SHIPPED) trong phiên.
        </p>

        <div className="mt-6 flex flex-wrap items-center justify-end gap-3">
          <div className="flex flex-col items-end gap-1">
            <button
              type="button"
              disabled
              title="Dashboard chi tiết sẽ có ở Plan 3"
              className="cursor-not-allowed rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-400 dark:border-zinc-700 dark:text-zinc-600"
            >
              Xem Dashboard chi tiết
            </button>
            <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
              Plan 3
            </span>
          </div>
          <button
            type="button"
            autoFocus
            onClick={onClose}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
          >
            Đóng
          </button>
        </div>
      </div>
    </div>
  );
}
