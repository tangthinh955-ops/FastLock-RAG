"use client";

import type { LiveOrder } from "@/hooks/useLiveSocket";

type OrderStatus = LiveOrder["order"]["status"];

const priceFormatter = new Intl.NumberFormat("vi-VN", {
  maximumFractionDigits: 0,
});

/** `300.000đ` theo cách đọc tiền Việt. */
function formatVnd(value: number): string {
  return `${priceFormatter.format(value)}đ`;
}

const STATUS_META: Record<
  OrderStatus,
  { label: string; className: string }
> = {
  PENDING: {
    label: "Chờ thanh toán",
    className: "text-amber-700 dark:text-amber-400",
  },
  PAID: {
    label: "Đã thanh toán",
    className: "text-emerald-700 dark:text-emerald-400",
  },
  SHIPPED: {
    label: "Đã giao",
    className: "text-sky-700 dark:text-sky-400",
  },
  CANCELLED: {
    label: "Đã huỷ",
    className: "text-red-600 dark:text-red-400",
  },
};

/**
 * "Đơn nổ realtime" (spec §5.5): danh sách cập nhật thuần từ `new_order`,
 * không reload. Thẻ đầu tiên là đơn vừa nổ — viền emerald + nhãn "vừa xong";
 * các thẻ cũ hơn giữ viền trung tính.
 */
export default function LiveOrderPanel({ orders }: { orders: LiveOrder[] }) {
  return (
    <section className="flex min-h-[280px] flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm lg:min-h-0 dark:border-zinc-800 dark:bg-zinc-950">
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <h2 className="text-sm font-semibold tracking-tight">
          🧾 Đơn nổ realtime
        </h2>
        <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-500 tabular-nums dark:bg-zinc-800 dark:text-zinc-400">
          {orders.length}
        </span>
      </header>

      <div className="flex-1 space-y-2 overflow-y-auto px-4 py-3" aria-live="polite">
        {orders.length === 0 ? (
          <p className="grid h-full place-items-center px-4 text-center text-sm text-zinc-500 dark:text-zinc-400">
            Chưa có đơn — khách gõ mã SP trong comment để chốt đơn.
          </p>
        ) : (
          orders.map(({ order, buyerName }, index) => {
            const newest = index === 0;
            const status = STATUS_META[order.status];

            return (
              <article
                key={order.id}
                className={`rounded-xl border px-3 py-2.5 transition-colors ${
                  newest
                    ? "border-2 border-emerald-500 bg-emerald-50/70 dark:border-emerald-500 dark:bg-emerald-950/25"
                    : "border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950"
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="truncate text-sm font-semibold tracking-tight">
                    #{order.code} · {buyerName}
                  </p>
                  {newest ? (
                    <span className="shrink-0 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                      vừa xong
                    </span>
                  ) : null}
                </div>

                <p className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm text-zinc-600 dark:text-zinc-300">
                  <span className="font-medium text-zinc-800 dark:text-zinc-100">
                    {order.sku} ×{order.qty}
                  </span>
                  <span aria-hidden>·</span>
                  <span className="font-semibold tabular-nums">
                    {formatVnd(order.total)}
                  </span>
                  <span aria-hidden>·</span>
                  <span className={`text-xs font-semibold ${status.className}`}>
                    {status.label}
                  </span>
                </p>
              </article>
            );
          })
        )}
      </div>
    </section>
  );
}
