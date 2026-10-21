import Link from "next/link";
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
 * Mỗi dòng đơn + footer "Xem đơn & QR →" mở `/orders?order=<id>` (Plan 3 Task 1):
 * khách xem chi tiết, QR giả lập và thanh toán ngay tại đó.
 */
export default function MyOrderCard({ orders }: { orders: LiveOrder[] }) {
  if (orders.length === 0) {
    return null;
  }

  // Hook chèn đơn mới vào ĐẦU mảng — phần tử 0 là đơn mới nhất.
  const newest = orders[0]?.order;

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
            <li key={order.id}>
              <Link
                href={`/orders?order=${order.id}`}
                className="block px-3 py-2 transition hover:bg-zinc-50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-emerald-600"
              >
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
              </Link>
            </li>
          );
        })}
      </ul>

      <div className="border-t border-zinc-100 px-3 py-2">
        <Link
          href={newest === undefined ? "/orders" : `/orders?order=${newest.id}`}
          className="text-xs font-semibold text-emerald-700 transition hover:text-emerald-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
        >
          Xem đơn &amp; QR →
        </Link>
      </div>
    </section>
  );
}
