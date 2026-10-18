import Link from "next/link";
import type { LiveSession, Shop } from "@/generated/prisma/client";

/** Shop kèm `_count.products` mà trang chủ query bằng `include`. */
type ShopWithProductCount = Shop & { _count: { products: number } };

type ShopCardProps = {
  shop: ShopWithProductCount;
  /** Có phiên LIVE → card live; `null` → card offline. */
  session: LiveSession | null;
};

/** Giờ bắt đầu theo giờ Việt Nam, dạng HH:mm (Intl, không hard-code múi giờ máy). */
function formatStartedAt(date: Date): string {
  return new Intl.DateTimeFormat("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Ho_Chi_Minh",
  }).format(date);
}

function shopInitial(name: string): string {
  return name.trim().charAt(0).toLocaleUpperCase("vi") || "?";
}

/**
 * Một shop trong danh sách Trang chủ.
 *
 * - Live: toàn card là `<Link>` tới `/live/{sessionId}` (trang xem live do
 *   Task 14 làm — hiện 404 là bình thường), banner gradient 16:9 + badge
 *   `● LIVE` + tiêu đề live + giờ bắt đầu + CTA emerald.
 * - Offline: card tĩnh (không link, không nút Nhắn tin — Plan 2 mới thêm theo B4).
 */
export default function ShopCard({ shop, session }: ShopCardProps) {
  const initial = shopInitial(shop.name);

  if (!session) {
    return (
      <article className="flex flex-col rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <div className="flex items-center gap-3">
          <span
            aria-hidden
            className="grid size-11 shrink-0 place-items-center rounded-full bg-zinc-100 text-lg font-semibold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
          >
            {initial}
          </span>
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold tracking-tight">
              {shop.name}
            </h2>
            <span className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-zinc-100 px-2.5 py-0.5 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
              <span aria-hidden className="size-1.5 rounded-full bg-zinc-400" />
              Đang offline
            </span>
          </div>
        </div>
        <p className="mt-4 text-sm text-zinc-500 dark:text-zinc-400">
          {shop._count.products} sản phẩm
        </p>
      </article>
    );
  }

  return (
    <Link
      href={`/live/${session.id}`}
      className="group flex flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-emerald-600 dark:border-zinc-800 dark:bg-zinc-950"
    >
      <div className="relative flex aspect-video items-center justify-center overflow-hidden bg-gradient-to-br from-zinc-900 via-zinc-800 to-emerald-950">
        <span
          aria-hidden
          className="text-6xl font-black text-white/10 select-none"
        >
          {initial}
        </span>
        <span className="absolute top-3 left-3 inline-flex animate-pulse items-center rounded-full bg-rose-600 px-2.5 py-1 text-xs font-semibold tracking-wide text-white shadow-sm">
          ● LIVE
        </span>
        <span
          aria-hidden
          className="absolute right-3 bottom-3 grid size-9 place-items-center rounded-full bg-white/10 text-sm text-white/80 backdrop-blur transition group-hover:bg-white/20"
        >
          ▶
        </span>
      </div>

      <div className="flex flex-1 flex-col gap-1.5 p-5">
        <p className="text-xs font-medium tracking-wide text-rose-600 uppercase dark:text-rose-400">
          Đang lên sóng
        </p>
        <h2 className="text-lg font-semibold tracking-tight">{shop.name}</h2>
        <p className="line-clamp-2 text-sm text-zinc-600 dark:text-zinc-300">
          {session.title}
        </p>
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          Bắt đầu lúc {formatStartedAt(session.startedAt)}
        </p>
        <span className="mt-3 inline-flex w-fit items-center rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition group-hover:bg-emerald-700">
          Xem live →
        </span>
      </div>
    </Link>
  );
}
