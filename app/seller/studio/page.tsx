import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect, unstable_rethrow } from "next/navigation";
import HomeHeader from "@/components/home/HomeHeader";
import StudioClient from "@/components/studio/StudioClient";
import { COOKIE_NAME } from "@/lib/auth/constants";
import { requireUser } from "@/lib/auth/guards";
import type { TokenPayload } from "@/lib/auth/token";
import { prisma } from "@/lib/db";

export const metadata: Metadata = { title: "Studio — LiveOrder Demo" };

/**
 * Studio đọc cookie phiên + query DB (shop, số sản phẩm, phiên LIVE mới nhất)
 * nên luôn render theo từng request — không được prerender tĩnh.
 *
 * Cùng lý do và cùng cách xử lý với `app/page.tsx`: Next 16 + `cacheComponents`
 * coi đây là route blocking khi dùng `cookies()`/DB ngoài `<Suspense>`;
 * `instant = false` là cấu hình docs chỉ định cho segment được phép block
 * (xem `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/02-route-segment-config/instant.md`).
 */
export const instant = false;

export default async function SellerStudioPage() {
  // Proxy đã chặn `/seller/*`, nhưng đây mới là lớp guard thật: proxy chỉ là
  // kiểm tra lạc quan, còn trang phải tự xác thực lại từ cookie.
  let user: TokenPayload | null = null;
  try {
    user = await requireUser("SELLER");
  } catch (error) {
    // `requireUser` gọi `cookies()` — lỗi bail-out của Next (không phải 401/403)
    // phải để Next xử lý, không được nuốt rồi redirect sai (docs
    // `unstable_rethrow`). Người dùng thật sự không hợp lệ mới về /login.
    unstable_rethrow(error);
    redirect("/login");
  }

  if (user === null) {
    redirect("/login");
  }

  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (token === undefined) {
    redirect("/login");
  }

  const shop = await prisma.shop.findUnique({
    where: { ownerId: user.userId },
    include: {
      _count: { select: { products: true } },
      sessions: {
        where: { status: "LIVE" },
        orderBy: { startedAt: "desc" },
        take: 1,
        select: { id: true, title: true },
      },
    },
  });

  if (shop === null) {
    return (
      <>
        <HomeHeader user={user} />
        <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-16">
          <div className="rounded-2xl border border-dashed border-zinc-300 bg-white px-6 py-12 text-center dark:border-zinc-700 dark:bg-zinc-950">
            <p className="text-4xl" aria-hidden>
              🏪
            </p>
            <h1 className="mt-4 text-2xl font-semibold tracking-tight">
              Tài khoản chưa có shop
            </h1>
            <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
              Studio chỉ dành cho tài khoản seller đã được gắn shop. Hãy dùng
              tài khoản shop demo hoặc liên hệ quản trị viên.
            </p>
          </div>
        </main>
      </>
    );
  }

  const activeSession = shop.sessions[0] ?? null;

  return (
    <>
      <HomeHeader user={user} />
      <StudioClient
        token={token}
        user={user}
        shopName={shop.name}
        productCount={shop._count.products}
        activeSession={
          activeSession === null
            ? null
            : { id: activeSession.id, title: activeSession.title }
        }
        demoMode={process.env.DEMO_MODE === "true"}
      />
    </>
  );
}
