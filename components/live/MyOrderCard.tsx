import type { LiveOrder } from "@/hooks/useLiveSocket";

type OrderStatus = LiveOrder["order"]["status"];

const priceFormatter = new Intl.NumberFormat("vi-VN", {
  maximumFractionDigits: 0,
});

function formatVnd(value: number): string {
  return `${priceFormatter.format(value)}đ`;
}

const STATUS_META: Record<
  OrderStatus,
  { label: string; className: string }
> = {
  PENDING: { label: "Chờ thanh toán", className: "text-amber-700" },
  PAID: { label: "Đã thanh toán", className: "text-emerald-700" },
  SHIPPED: { label: "Đã giao", className: "text-sky-700" },
  CANCELLED: { label: "Đã huỷ", className: "text-red-600" },
};

/**
 * Thẻ "📦 Đơn của bạn" góc phải-dưới (mockup Option B). Chỉ nhận đơn đã lọc
 * đúng `buyerId === userId` từ ViewerClient; ẩn hoàn toàn khi chưa có đơn.
 *
 * Link `/orders` bị disable có chủ đích — trang Đơn của tôi + QR thuộc Plan 3,
 * ghi rõ "Plan 3" để người xem demo không tưởng là lỗi.
 */
export default function MyOrderCard({ orders }: { orders: LiveOrder[] }) {
  if (orders.length === 0) {
    return null;
  }

  return (
    <section className="w-full overflow-hidden rounded-xl border border-zinc-200 bg-white text-zinc-900 shadow-xl">
      <header className="flex items-center justify-between gap-2 border-b border-zinc-200 px-3 py-2">
        <h2 className="text-xs font-semibold tracking-tight">
          📦 Đơn của bạn
        </h2>
        <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-600 tabular-nums">
          {orders.length}
        </span>
      </header>

      <ul className="max-h-40 divide-y divide-zinc-100 overflow-y-auto">
        {orders.map(({ order }) => {
          const status = STATUS_META[order.status];
          return (
            <li key={order.id} className="px-3 py-2">
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-xs font-semibold">#{order.code}</p>
                <p className={`text-[11px] font-medium ${status.className}`}>
                  {status.label}
                </p>
              </div>
              <p className="mt-0.5 text-xs text-zinc-600">
                {order.sku} ×{order.qty} ·{" "}
                <span className="font-semibold text-zinc-900 tabular-nums">
                  {formatVnd(order.total)}
                </span>
              </p>
            </li>
          );
        })}
      </ul>

      <div className="flex flex-col gap-0.5 border-t border-zinc-100 px-3 py-2">
        <button
          type="button"
          disabled
          title="Trang Đơn của tôi sẽ có ở Plan 3"
          className="cursor-not-allowed text-left text-xs font-semibold text-zinc-400"
        >
          Xem đơn &amp; QR →
        </button>
        <span className="text-[10px] text-zinc-400">Plan 3 · /orders</span>
      </div>
    </section>
  );
}
