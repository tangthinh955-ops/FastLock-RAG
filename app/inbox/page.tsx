import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Inbox AI — LiveOrder Demo" };

/**
 * Placeholder Plan 1 cho `/inbox` (proxy đã bảo vệ route). Inbox AI thật —
 * RAG tư vấn 24/7, chip nguồn, takeover — thuộc Plan 2; trang này chỉ giữ chỗ
 * để nút "Tư vấn" ở màn xem live có đích đến, không chứa logic AI/RAG.
 */
export default function InboxPage() {
  return (
    <main className="flex flex-1 items-center justify-center px-6 py-16">
      <div className="w-full max-w-lg rounded-2xl border border-zinc-200 bg-white p-8 text-center shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <span
          aria-hidden
          className="mx-auto grid size-14 place-items-center rounded-2xl bg-emerald-50 text-3xl dark:bg-emerald-950/50"
        >
          💬
        </span>
        <h1 className="mt-4 text-2xl font-semibold tracking-tight">Inbox AI</h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          Sẽ hoàn thiện ở Plan 2 (RAG tư vấn 24/7).
        </p>
        <p className="mt-4 text-sm text-zinc-500 dark:text-zinc-400">
          Plan 1 tập trung vào lõi bán hàng livestream: bắt mã SKU trong comment,
          trừ kho nguyên tử và đơn nổ realtime. Hội thoại AI, chip nguồn và
          takeover của seller sẽ có ở giai đoạn sau.
        </p>
        <Link
          href="/"
          className="mt-6 inline-flex items-center rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-700"
        >
          ← Về trang chủ
        </Link>
      </div>
    </main>
  );
}
