import type { Metadata } from "next";
import { cookies } from "next/headers";
import HomeHeader from "@/components/home/HomeHeader";
import ShopCard from "@/components/home/ShopCard";
import { COOKIE_NAME } from "@/lib/auth/constants";
import { verifyToken } from "@/lib/auth/token";
import { prisma } from "@/lib/db";
import { getActiveLive } from "@/lib/live/sessions";
import type { LiveSession } from "@/generated/prisma/client";

export const metadata: Metadata = { title: "Trang chủ — LiveOrder Demo" };

/**
 * Trang chủ đọc cookie phiên + query DB trực tiếp, nên luôn render theo từng
 * request: trạng thái live đổi là HTML đổi ngay, không được prerender tĩnh.
 *
 * Next 16 + `cacheComponents: true` coi đây là route blocking; `instant = false`
 * là cách đơn giản nhất mà docs chỉ định cho trường hợp uncached data +
 * `cookies()` ngoài `<Suspense>` (xem
 * `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/02-route-segment-config/instant.md`
 * và mục "A blocking product page" trong `.../02-guides/building.md`).
 */
export const instant = false;

export default async function Home() {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;

  const [user, active, shops] = await Promise.all([
    token ? verifyToken(token) : Promise.resolve(null),
    getActiveLive(prisma),
    prisma.shop.findMany({
      include: { _count: { select: { products: true } } },
    }),
  ]);

  // `active` đã sort mới nhất trước; giữ phiên đầu tiên gặp cho mỗi shop để
  // trường hợp dữ liệu bất thường có 2 phiên LIVE cùng shop vẫn chọn mới nhất.
  const liveByShop = new Map<string, LiveSession>();
  for (const { session } of active) {
    if (!liveByShop.has(session.shopId)) {
      liveByShop.set(session.shopId, session);
    }
  }

  const liveShops: Array<{ shop: (typeof shops)[number]; session: LiveSession }> =
    [];
  const offlineShops: Array<(typeof shops)[number]> = [];
  for (const shop of shops) {
    const session = liveByShop.get(shop.id);
    if (session) {
      liveShops.push({ shop, session });
    } else {
      offlineShops.push(shop);
    }
  }

  liveShops.sort(
    (a, b) => b.session.startedAt.getTime() - a.session.startedAt.getTime(),
  );
  offlineShops.sort((a, b) => a.name.localeCompare(b.name, "vi"));

  return (
    <>
      <HomeHeader user={user} />

      <main className="flex flex-1 flex-col">
        <section className="mx-auto w-full max-w-6xl px-6 pt-12 pb-8 sm:pt-16">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
                Shop đang lên sóng
              </h1>
              <p className="mt-2 max-w-2xl text-zinc-600 dark:text-zinc-400">
                Chọn một shop để xem livestream và chốt đơn ngay trong khung
                chat.
              </p>
            </div>

            {liveShops.length > 0 && (
              <span className="inline-flex items-center rounded-full bg-rose-600 px-3 py-1 text-sm font-medium text-white shadow-sm">
                {liveShops.length} shop đang live
              </span>
            )}
          </div>
        </section>

        <section className="mx-auto w-full max-w-6xl px-6 pb-16">
          {shops.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-zinc-300 bg-white px-6 py-12 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-400">
              Chưa có shop nào — chạy npm run seed
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {liveShops.map(({ shop, session }) => (
                <ShopCard key={shop.id} shop={shop} session={session} />
              ))}
              {offlineShops.map((shop) => (
                <ShopCard key={shop.id} shop={shop} session={null} />
              ))}
            </div>
          )}
        </section>
      </main>
    </>
  );
}
