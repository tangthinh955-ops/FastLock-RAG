"use client";

import type { LiveComment } from "@/hooks/useLiveSocket";

const msFormatter = new Intl.NumberFormat("vi-VN", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

const timeFormatter = new Intl.DateTimeFormat("vi-VN", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
  timeZone: "Asia/Ho_Chi_Minh",
});

function formatMs(value: number): string {
  return msFormatter.format(value);
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "--:--:--";
  }
  return timeFormatter.format(date);
}

/**
 * Dải log kỹ thuật dưới webcam (spec §5.5): "khoe" Aho-Corasick đang chạy bằng
 * comment THẬT gần nhất có bắt được SKU. Không có comment/matches thì nói đúng
 * sự thật — tuyệt đối không bịa số ms hay mã đơn.
 */
export default function EngineLogStrip({
  productCount,
  comments,
}: {
  productCount: number;
  comments: LiveComment[];
}) {
  let latest: LiveComment | null = null;
  for (let index = comments.length - 1; index >= 0; index -= 1) {
    if (comments[index].matches.length > 0) {
      latest = comments[index];
      break;
    }
  }

  const match = latest?.matches[0] ?? null;
  const elapsedMs =
    latest !== null && typeof latest.elapsedMs === "number"
      ? latest.elapsedMs
      : null;

  return (
    <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-zinc-200 bg-zinc-50 px-4 py-2 font-mono text-[11px] text-zinc-600 sm:text-xs dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-400">
      <p className="flex flex-wrap items-center gap-x-1.5">
        <span>
          ⚙️ Aho-Corasick theo dõi{" "}
          <strong className="font-semibold text-zinc-900 dark:text-zinc-100">
            {productCount} mã SKU
          </strong>
        </span>
        <span aria-hidden>·</span>
        {latest !== null && match !== null ? (
          <span>
            log:{" "}
            <strong className="font-semibold text-zinc-900 dark:text-zinc-100">
              {formatTime(latest.createdAt)}
            </strong>{" "}
            bắt &quot;{match.sku}&quot;
            {latest.orderCode !== undefined ? (
              <>
                {" "}
                → Đơn{" "}
                <strong className="font-semibold text-emerald-700 dark:text-emerald-400">
                  #{latest.orderCode}
                </strong>
              </>
            ) : null}
            {elapsedMs !== null ? (
              <>
                {" "}
                ·{" "}
                <strong className="font-semibold text-zinc-900 dark:text-zinc-100">
                  {formatMs(elapsedMs)} ms
                </strong>
              </>
            ) : null}
          </span>
        ) : (
          <span>
            {comments.length === 0
              ? "chưa có comment"
              : "chưa bắt được mã SKU nào"}
          </span>
        )}
      </p>

      <span className="shrink-0 rounded-full border border-zinc-300 px-2 py-0.5 text-[10px] font-medium tracking-wide text-zinc-500 uppercase dark:border-zinc-700 dark:text-zinc-400">
        🔍 Kỹ thuật · bật
      </span>
    </div>
  );
}
