import Link from "next/link";

/**
 * Nút "💬 Tư vấn" góc trên phải stage (mockup Option B). Chỉ render khi đã
 * đăng nhập (ViewerClient quyết định) — dẫn sang Inbox AI placeholder của
 * Plan 2 kèm `shopId` để màn hình sau biết đang tư vấn shop nào.
 */
export default function ConsultButton({ shopId }: { shopId: string }) {
  return (
    <Link
      href={`/inbox?shopId=${encodeURIComponent(shopId)}`}
      className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-zinc-900 shadow-lg transition hover:bg-emerald-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400"
    >
      <span aria-hidden>💬</span> Tư vấn
    </Link>
  );
}
