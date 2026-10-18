import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { cache } from "react";
import ViewerClient from "@/components/live/ViewerClient";
import { COOKIE_NAME } from "@/lib/auth/constants";
import { verifyToken } from "@/lib/auth/token";
import { prisma } from "@/lib/db";

type LivePageProps = { params: Promise<{ id: string }> };

/**
 * Trang xem live đọc cookie (để biết khách đã đăng nhập chưa) + query DB trực
 * tiếp nên luôn render theo từng request.
 *
 * Cùng lý do và cùng cách xử lý với `app/page.tsx` / Studio: Next 16 +
 * `cacheComponents` coi `cookies()`/DB ngoài `<Suspense>` là route blocking;
 * `instant = false` là cấu hình docs chỉ định cho segment được phép block (xem
 * `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/02-route-segment-config/instant.md`).
 */
export const instant = false;

/**
 * `cache` của React gộp query giữa `generateMetadata` và page trong CÙNG một
 * request — trang không query phiên live hai lần chỉ để lấy title.
 */
const getLiveSession = cache(async (id: string) => {
  return prisma.liveSession.findUnique({
    where: { id },
    include: { shop: { select: { id: true, name: true } } },
  });
});

export async function generateMetadata({
  params,
}: LivePageProps): Promise<Metadata> {
  const { id } = await params;
  const session = await getLiveSession(id);
  return {
    title:
      session === null
        ? "Xem live — LiveOrder Demo"
        : `Live — ${session.shop.name}`,
  };
}

export default async function LivePage({ params }: LivePageProps) {
  const { id } = await params;

  // Không dùng `requireUser`: khách ẩn danh vẫn xem được stage. Cookie hỏng/hết
  // hạn cũng chỉ hạ về khách, không chặn trang.
  const cookieStore = await cookies();
  const cookieToken = cookieStore.get(COOKIE_NAME)?.value ?? null;
  const user = cookieToken === null ? null : await verifyToken(cookieToken);
  const token = user === null ? null : cookieToken;

  const session = await getLiveSession(id);
  if (session === null) {
    notFound();
  }

  return (
    <ViewerClient
      token={token}
      userId={user?.userId ?? null}
      userName={user?.name ?? null}
      session={{
        id: session.id,
        title: session.title,
        status: session.status,
      }}
      shop={{ id: session.shop.id, name: session.shop.name }}
      initialEnded={session.status !== "LIVE"}
    />
  );
}
