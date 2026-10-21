"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Nút "Giả lập đã chuyển khoản" (Plan 3 Task 1): gọi `POST /api/orders/[id]/pay`
 * — đường DUY NHẤT đưa đơn sang PAID (chỉ khi `DEMO_MODE=true`). Server xác
 * thực quyền sở hữu + trạng thái; thành công thì `router.refresh()` để trang
 * server component render lại trạng thái PAID + banner, không tự đoán state.
 */
export default function PayButton({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handlePay() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/orders/${orderId}/pay`, {
        method: "POST",
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          error?: unknown;
        } | null;
        setError(
          typeof payload?.error === "string"
            ? payload.error
            : "Không thanh toán được, vui lòng thử lại",
        );
        return;
      }
      router.refresh();
    } catch {
      setError("Không kết nối được server, vui lòng thử lại");
    } finally {
      setPending(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={handlePay}
        disabled={pending}
        className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? "Đang xử lý…" : "Giả lập đã chuyển khoản"}
      </button>
      {error !== null && (
        <p role="alert" className="mt-2 text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
