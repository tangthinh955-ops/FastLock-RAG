import type { Metadata } from "next";
import { redirect, unstable_rethrow } from "next/navigation";
import HomeHeader from "@/components/home/HomeHeader";
import SellerProductsClient, {
  type SellerProductRow,
} from "@/components/products/SellerProductsClient";
import { requireUser } from "@/lib/auth/guards";
import type { TokenPayload } from "@/lib/auth/token";
import { prisma } from "@/lib/db";
import { listShopProducts } from "@/lib/products/service";

export const metadata: Metadata = { title: "Sản phẩm của shop — LiveOrder Demo" };

/**
 * Trang CRUD sản phẩm của seller (Plan 3 Task 3 — spec §5.8): đọc cookie phiên
 * + query DB nên luôn render theo từng request, cùng lý do và cách xử lý với
 * `/seller/orders` (`instant = false`). Guard thật nằm ở đây; proxy chỉ là lớp
 * lạc quan.
 *
 * Danh tính lấy từ JWT; shop tra theo `ownerId` — không có `shopId` nào đến từ
 * URL/client. Mọi thao tác ghi đi qua REST rồi `router.refresh()`.
 */
export const instant = false;

export default async function SellerProductsPage() {
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
              Trang sản phẩm chỉ dành cho tài khoản seller đã được gắn shop. Hãy
              dùng tài khoản shop demo hoặc liên hệ quản trị viên.
            </p>
          </div>
        </main>
      </>
    );
  }

  const products = await listShopProducts(prisma, shop.id);

  // Chỉ chuyển dữ liệu thật cần cho bảng — ảnh là đường dẫn nội bộ /uploads/.
  const rows: SellerProductRow[] = products.map((product) => ({
    id: product.id,
    sku: product.sku,
    name: product.name,
    price: product.price,
    stock: product.stock,
    imageUrl: product.imageUrl,
  }));

  return (
    <>
      <HomeHeader user={user} />
      <SellerProductsClient shopName={shop.name} products={rows} />
    </>
  );
}
