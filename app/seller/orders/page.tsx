import type { Metadata } from "next";
import { redirect, unstable_rethrow } from "next/navigation";
import HomeHeader from "@/components/home/HomeHeader";
import SellerOrdersClient, {
  type SellerOrderRow,
} from "@/components/orders/SellerOrdersClient";
import { requireUser } from "@/lib/auth/guards";
import type { TokenPayload } from "@/lib/auth/token";
import { prisma } from "@/lib/db";
import { listShopOrders } from "@/lib/orders/service";

export const metadata: Metadata = { title: "Đơn của shop — LiveOrder Demo" };

/**
 * Trang quản lý đơn của seller (Plan 3 Task 2 — spec §5.9): đọc cookie phiên +
 * query DB nên luôn render theo từng request, cùng lý do và cùng cách xử lý với
 * Studio (`instant = false`). Guard thật nằm ở đây, proxy chỉ là lớp lạc quan.
 *
 * Danh tính lấy từ JWT; shop tra theo `ownerId` — không có `shopId` nào đến từ
 * URL/client. Hành động giao/hủy đi qua REST rồi `router.refresh()`.
 */
export const instant = false;

const dateTimeFormatter = new Intl.DateTimeFormat("vi-VN", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export default async function SellerOrdersPage() {
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

  const shop = await prisma.shop.findUnique({
    where: { ownerId: user.userId },
    select: { id: true, name: true },
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
              Trang đơn chỉ dành cho tài khoản seller đã được gắn shop. Hãy dùng
              tài khoản shop demo hoặc liên hệ quản trị viên.
            </p>
          </div>
        </main>
      </>
    );
  }

  const orders = await listShopOrders(prisma, shop.id);

  // Format ngày ở server: client hydrate không lệch múi giờ giữa máy chủ và
  // trình duyệt. Chỉ chuyển dữ liệu thật cần cho bảng.
  const rows: SellerOrderRow[] = orders.map((order) => ({
    id: order.id,
    code: order.code,
    buyerName: order.buyer.name,
    productName: order.product.name,
    sku: order.product.sku,
    qty: order.qty,
    total: order.total,
    status: order.status,
    createdAtLabel: dateTimeFormatter.format(order.createdAt),
  }));

  return (
    <>
      <HomeHeader user={user} />
      <SellerOrdersClient shopName={shop.name} orders={rows} />
    </>
  );
}
