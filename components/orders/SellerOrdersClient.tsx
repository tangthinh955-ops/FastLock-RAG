"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

export type SellerOrderRow = {
  id: string;
  code: number;
  buyerName: string;
  productName: string;
  sku: string;
  qty: number;
  total: number;
  status: "PENDING" | "PAID" | "SHIPPED" | "CANCELLED";
  /** Đã format sẵn ở server để không lệch múi giờ khi hydrate. */
  createdAtLabel: string;
};

type SellerOrdersClientProps = {
  shopName: string;
  orders: SellerOrderRow[];
};

const priceFormatter = new Intl.NumberFormat("vi-VN", {
  maximumFractionDigits: 0,
});

function formatVnd(value: number): string {
  return `${priceFormatter.format(value)}đ`;
}

/** Nhãn ngắn gọn, cùng bộ nhãn với `MyOrderCard`/`/orders`. */
const STATUS_META: Record<
  SellerOrderRow["status"],
  { label: string; badge: string }
> = {
  PENDING: {
    label: "Chờ thanh toán",
    badge:
      "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300",
  },
  PAID: {
    label: "Đã thanh toán",
    badge:
      "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300",
  },
  SHIPPED: {
    label: "Đã giao",
    badge: "bg-sky-100 text-sky-800 dark:bg-sky-950/60 dark:text-sky-300",
  },
  CANCELLED: {
    label: "Đã huỷ",
    badge: "bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-300",
  },
};

type Mutation = "ship" | "cancel";

/**
 * Bảng đơn của shop (Plan 3 Task 2): mỗi dòng một đơn, nút hành động theo
 * trạng thái. Client KHÔNG tự đoán trạng thái mới — gọi REST rồi
 * `router.refresh()` để server component render lại từ DB.
 *
 * `pendingId` chặn double-click và mọi thao tác chen ngang khi một request
 * đang chạy; lỗi 404/409 từ server hiện nguyên câu tiếng Việt trong banner.
 */
export default function SellerOrdersClient({
  shopName,
  orders,
}: SellerOrdersClientProps) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function mutate(order: SellerOrderRow, action: Mutation) {
    if (pendingId !== null) return;
    setError(null);
    setPendingId(order.id);
    try {
      const response = await fetch(
        `/api/seller/orders/${order.id}/${action}`,
        { method: "POST" },
      );
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          error?: unknown;
        } | null;
        setError(
          typeof payload?.error === "string"
            ? payload.error
            : "Không thực hiện được thao tác, vui lòng thử lại",
        );
        return;
      }
      router.refresh();
    } catch {
      setError("Không kết nối được máy chủ, vui lòng thử lại");
    } finally {
      setPendingId(null);
    }
  }

  function handleCancel(order: SellerOrderRow) {
    if (
      !window.confirm(`Hủy đơn #${order.code}? Kho sẽ được hoàn lại.`)
    ) {
      return;
    }
    void mutate(order, "cancel");
  }

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            🧾 Đơn của shop
          </h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Đơn của <strong className="font-semibold">{shopName}</strong> — giao
            đơn đã thanh toán, hủy đơn còn chờ và hoàn kho tự động.
          </p>
        </div>
        <Link
          href="/seller/studio"
          className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium transition hover:bg-zinc-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 dark:border-zinc-700 dark:hover:bg-zinc-900"
        >
          🎥 Studio
        </Link>
      </div>

      {error !== null && (
        <p
          role="alert"
          className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
        >
          {error}
        </p>
      )}

      {orders.length === 0 ? (
        <div className="mt-8 rounded-2xl border border-dashed border-zinc-300 px-6 py-14 text-center dark:border-zinc-700">
          <span
            aria-hidden
            className="mx-auto grid size-14 place-items-center rounded-2xl bg-emerald-50 text-3xl dark:bg-emerald-950/50"
          >
            🧾
          </span>
          <p className="mx-auto mt-3 max-w-md text-sm text-zinc-600 dark:text-zinc-400">
            Shop chưa có đơn nào — mở live và chốt đơn để thấy đơn tại đây.
          </p>
          <Link
            href="/seller/studio"
            className="mt-4 inline-flex items-center rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
          >
            🎥 Vào Studio
          </Link>
        </div>
      ) : (
        <div className="mt-6 overflow-x-auto rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
          <table className="w-full min-w-[46rem] border-collapse text-left text-sm">
            <thead className="border-b border-zinc-200 bg-zinc-50 text-xs tracking-wide text-zinc-500 uppercase dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-400">
              <tr>
                <th scope="col" className="px-4 py-3 font-semibold">
                  Mã đơn
                </th>
                <th scope="col" className="px-4 py-3 font-semibold">
                  Khách
                </th>
                <th scope="col" className="px-4 py-3 font-semibold">
                  Sản phẩm
                </th>
                <th scope="col" className="px-4 py-3 text-right font-semibold">
                  Tổng
                </th>
                <th scope="col" className="px-4 py-3 font-semibold">
                  Trạng thái
                </th>
                <th scope="col" className="px-4 py-3 font-semibold">
                  Tạo lúc
                </th>
                <th scope="col" className="px-4 py-3 text-right font-semibold">
                  Hành động
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {orders.map((order) => {
                const status = STATUS_META[order.status];
                const pending = pendingId === order.id;
                return (
                  <tr key={order.id}>
                    <td className="px-4 py-3 font-semibold whitespace-nowrap tabular-nums">
                      #{order.code}
                    </td>
                    <td className="max-w-[12rem] truncate px-4 py-3">
                      {order.buyerName}
                    </td>
                    <td className="px-4 py-3">
                      <span className="block max-w-[16rem] truncate font-medium">
                        {order.productName}
                      </span>
                      <span className="text-xs text-zinc-500 dark:text-zinc-400">
                        {order.sku} ×{order.qty}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-semibold whitespace-nowrap tabular-nums">
                      {formatVnd(order.total)}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap ${status.badge}`}
                      >
                        {status.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs whitespace-nowrap text-zinc-500 tabular-nums dark:text-zinc-400">
                      {order.createdAtLabel}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      {order.status === "PENDING" ? (
                        <button
                          type="button"
                          onClick={() => handleCancel(order)}
                          disabled={pendingId !== null}
                          className="rounded-lg border border-red-300 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 transition hover:bg-red-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600 disabled:cursor-not-allowed disabled:opacity-60 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300 dark:hover:bg-red-950/70"
                        >
                          {pending ? "Đang hủy…" : "Hủy đơn"}
                        </button>
                      ) : order.status === "PAID" ? (
                        <button
                          type="button"
                          onClick={() => void mutate(order, "ship")}
                          disabled={pendingId !== null}
                          className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {pending ? "Đang giao…" : "Giao hàng"}
                        </button>
                      ) : (
                        <span
                          aria-hidden
                          className="text-xs text-zinc-400 dark:text-zinc-600"
                        >
                          —
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-4 text-xs text-zinc-500 dark:text-zinc-400">
        Đơn PAID không hủy được trong bản demo (không hoàn tiền) — spec §13.7.
      </p>
    </main>
  );
}
