"use client";

import { useEffect } from "react";
import type { LiveOrder } from "@/hooks/useLiveSocket";

/** Tự tắt sau 5 giây, đúng nhịp toast "đơn nổ" của mockup. */
const TOAST_DURATION_MS = 5000;

const priceFormatter = new Intl.NumberFormat("vi-VN", {
  maximumFractionDigits: 0,
});

function formatVnd(value: number): string {
  return `${priceFormatter.format(value)}đ`;
}

type OrderToastProps = {
  order: LiveOrder["order"];
  onDismiss: (orderId: string) => void;
};

/**
 * Toast trắng cho đơn của CHÍNH người xem (mockup Option B): `✅ Chốt đơn #X —
 * SKU ×SL · tổngđ`, tự tắt sau ~5s. Việc giới hạn tối đa 3 toast nằm ở
 * `ViewerClient`; component này chỉ lo hẹn giờ cho đúng một đơn.
 */
export default function OrderToast({ order, onDismiss }: OrderToastProps) {
  useEffect(() => {
    const timer = setTimeout(() => {
      onDismiss(order.id);
    }, TOAST_DURATION_MS);

    return () => clearTimeout(timer);
  }, [onDismiss, order.id]);

  return (
    <div
      role="status"
      className="pointer-events-auto rounded-xl border border-zinc-200 bg-white px-3.5 py-2.5 text-sm text-zinc-900 shadow-xl"
    >
      <p className="text-sm tracking-tight">
        <span className="font-semibold">✅ Chốt đơn #{order.code}</span> —{" "}
        {order.sku} ×{order.qty} ·{" "}
        <span className="font-semibold text-emerald-700 tabular-nums">
          {formatVnd(order.total)}
        </span>
      </p>
    </div>
  );
}
