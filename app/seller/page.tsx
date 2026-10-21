import type { Metadata } from "next";
import Link from "next/link";
import { redirect, unstable_rethrow } from "next/navigation";
import RevenueChart from "@/components/dashboard/RevenueChart";
import HomeHeader from "@/components/home/HomeHeader";
import { requireUser } from "@/lib/auth/guards";
import { ApiError } from "@/lib/auth/service";
import type { TokenPayload } from "@/lib/auth/token";
import {
  getDashboardStats,
  type DashboardRange,
} from "@/lib/dashboard/service";
import { prisma } from "@/lib/db";
import { requireSellerShop } from "@/lib/live/sessions";

export const metadata: Metadata = { title: "Dashboard — LiveOrder Demo" };

/**
 * Dashboard của seller (Plan 3 Task 5 — spec §5.6): doanh thu, đơn, sản phẩm,
 * phiên live và hiệu quả AI theo bộ lọc Hôm nay/7/30 ngày.
 *
 * Đọc cookie phiên + query DB nên luôn render theo từng request, cùng lý do và
 * cùng cách xử lý với Studio/Inbox (`instant = false`; xem
 * `node_modules/next/dist/docs/.../instant.md`).
 *
 * Danh tính lấy từ JWT, shop lấy bằng `requireSellerShop(ownerId)` — không có
 * `shopId` nào đến từ URL/client. Mọi con số do `getDashboardStats` đọc DB; bộ
 * lọc chỉ là `Link` server-render, không cần client component.
 */
export const instant = false;

const priceFormatter = new Intl.NumberFormat("vi-VN", {
  maximumFractionDigits: 0,
});

const secondsFormatter = new Intl.NumberFormat("vi-VN", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

function formatVnd(value: number): string {
  return `${priceFormatter.format(value)}đ`;
}

const RANGE_OPTIONS = [
  { value: "today", label: "Hôm nay" },
  { value: "7d", label: "7 ngày" },
  { value: "30d", label: "30 ngày" },
] as const satisfies readonly { value: DashboardRange; label: string }[];

/** Chỉ nhận `today|7d|30d`; thiếu/giá trị lạ → `7d` (có số seed ngay). */
function parseRange(value: string | string[] | undefined): DashboardRange {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw === "today" || raw === "30d") {
    return raw;
  }
  return "7d";
}

const ORDER_STATUS_LABELS: Array<{
  key: keyof Awaited<ReturnType<typeof getDashboardStats>>["orderCounts"];
  label: string;
  badge: string;
}> = [
  {
    key: "pending",
    label: "PENDING",
    badge: "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300",
  },
  {
    key: "paid",
    label: "PAID",
    badge:
      "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300",
  },
  {
    key: "shipped",
    label: "SHIPPED",
    badge: "bg-sky-100 text-sky-800 dark:bg-sky-950/60 dark:text-sky-300",
  },
  {
    key: "cancelled",
    label: "CANCELLED",
    badge: "bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-300",
  },
];

type SellerDashboardPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function SellerDashboardPage({
  searchParams,
}: SellerDashboardPageProps) {
  let user: TokenPayload | null = null;
  try {
    user = await requireUser("SELLER");
  } catch (error) {
    // `requireUser` gọi `cookies()` — lỗi bail-out của Next phải để Next xử lý,
    // không được nuốt rồi redirect sai (docs `unstable_rethrow`).
    unstable_rethrow(error);
    redirect("/login");
  }

  if (user === null) {
    redirect("/login");
  }

  let shop: Awaited<ReturnType<typeof requireSellerShop>> | null = null;
  try {
    shop = await requireSellerShop(prisma, user.userId);
  } catch (error) {
    unstable_rethrow(error);
    if (!(error instanceof ApiError && error.status === 403)) {
      throw error;
    }
  }

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
              Dashboard chỉ dành cho tài khoản seller đã được gắn shop. Hãy dùng
              tài khoản shop demo hoặc liên hệ quản trị viên.
            </p>
          </div>
        </main>
      </>
    );
  }

  const range = parseRange((await searchParams).range);
  const stats = await getDashboardStats(prisma, shop.id, range);

  const totalOrders = Object.values(stats.orderCounts).reduce(
    (sum, count) => sum + count,
    0,
  );
  const rangeLabel =
    RANGE_OPTIONS.find((option) => option.value === range)?.label ?? "7 ngày";

  return (
    <>
      <HomeHeader user={user} />
      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              📊 Dashboard
            </h1>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
              Hiệu quả bán hàng của{" "}
              <strong className="font-semibold">{shop.name}</strong> — đọc trực
              tiếp từ dữ liệu shop.
            </p>
          </div>

          <nav
            aria-label="Khoảng thời gian"
            className="flex flex-wrap items-center gap-2"
          >
            {RANGE_OPTIONS.map((option) => {
              const active = option.value === range;
              return (
                <Link
                  key={option.value}
                  href={`/seller?range=${option.value}`}
                  aria-current={active ? "page" : undefined}
                  className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 ${
                    active
                      ? "border-emerald-600 bg-emerald-600 text-white"
                      : "border-zinc-300 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
                  }`}
                >
                  {option.label}
                </Link>
              );
            })}
          </nav>
        </div>

        <section
          aria-label="Chỉ số chính"
          className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
        >
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4 dark:border-emerald-900 dark:bg-emerald-950/40">
            <p className="text-xs font-medium tracking-wide text-emerald-700 uppercase dark:text-emerald-400">
              Doanh thu thực thu
            </p>
            <p className="mt-2 text-3xl font-bold tracking-tight text-emerald-800 tabular-nums dark:text-emerald-300">
              {formatVnd(stats.revenue)}
            </p>
            <p className="mt-1 text-xs text-emerald-700 dark:text-emerald-400">
              đơn đã thu tiền — PAID/SHIPPED
            </p>
          </div>

          <div className="rounded-2xl border border-zinc-200 bg-white px-5 py-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
            <p className="text-xs font-medium tracking-wide text-zinc-500 uppercase dark:text-zinc-400">
              Đơn theo trạng thái
            </p>
            <ul className="mt-3 flex flex-wrap gap-1.5">
              {ORDER_STATUS_LABELS.map((status) => (
                <li key={status.key}>
                  <span
                    className={`inline-flex items-baseline gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${status.badge}`}
                  >
                    {status.label}
                    <span className="tabular-nums">
                      {stats.orderCounts[status.key]}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
              {totalOrders} đơn tạo trong khoảng
            </p>
          </div>

          <div className="rounded-2xl border border-zinc-200 bg-white px-5 py-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
            <p className="text-xs font-medium tracking-wide text-zinc-500 uppercase dark:text-zinc-400">
              SP đã bán
            </p>
            <p className="mt-2 text-3xl font-bold tracking-tight tabular-nums">
              {stats.unitsSold}
            </p>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              sản phẩm · {totalOrders} đơn trong khoảng
            </p>
          </div>

          <div className="rounded-2xl border border-zinc-200 bg-white px-5 py-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
            <p className="text-xs font-medium tracking-wide text-zinc-500 uppercase dark:text-zinc-400">
              Đỉnh người xem
            </p>
            <p className="mt-2 text-3xl font-bold tracking-tight tabular-nums">
              {stats.peakViewers}
            </p>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              cao nhất các phiên live trong khoảng
            </p>
          </div>
        </section>

        <section
          aria-labelledby="hourly-revenue-title"
          className="mt-6 rounded-2xl border border-zinc-200 bg-white px-5 py-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2
              id="hourly-revenue-title"
              className="text-lg font-semibold tracking-tight"
            >
              Doanh thu theo giờ
            </h2>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              {rangeLabel} · giờ Việt Nam
            </p>
          </div>
          <RevenueChart data={stats.hourlyRevenue} />
        </section>

        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <section
            aria-labelledby="top-products-title"
            className="rounded-2xl border border-zinc-200 bg-white px-5 py-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950"
          >
            <h2
              id="top-products-title"
              className="text-lg font-semibold tracking-tight"
            >
              🏆 Top 5 sản phẩm
            </h2>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              Xếp theo số lượng bán của đơn đã thu tiền trong khoảng.
            </p>

            {stats.topProducts.length === 0 ? (
              <p className="mt-4 rounded-xl border border-dashed border-zinc-300 px-4 py-8 text-center text-sm text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">
                Chưa có sản phẩm nào được bán trong khoảng này
              </p>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[26rem] border-collapse text-left text-sm">
                  <thead className="border-b border-zinc-200 text-xs tracking-wide text-zinc-500 uppercase dark:border-zinc-800 dark:text-zinc-400">
                    <tr>
                      <th scope="col" className="py-2 pr-3 font-semibold">
                        Hạng
                      </th>
                      <th scope="col" className="py-2 pr-3 font-semibold">
                        Sản phẩm
                      </th>
                      <th
                        scope="col"
                        className="py-2 pr-3 text-right font-semibold"
                      >
                        Đã bán
                      </th>
                      <th scope="col" className="py-2 text-right font-semibold">
                        Doanh thu
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                    {stats.topProducts.map((product, index) => (
                      <tr key={product.sku}>
                        <td className="py-2.5 pr-3 font-semibold text-zinc-500 tabular-nums dark:text-zinc-400">
                          {index + 1}
                        </td>
                        <td className="py-2.5 pr-3">
                          <span className="block max-w-[16rem] truncate font-medium">
                            {product.name}
                          </span>
                          <span className="text-xs text-zinc-500 dark:text-zinc-400">
                            {product.sku}
                          </span>
                        </td>
                        <td className="py-2.5 pr-3 text-right font-semibold whitespace-nowrap tabular-nums">
                          {product.qty}
                        </td>
                        <td className="py-2.5 text-right font-semibold whitespace-nowrap tabular-nums">
                          {formatVnd(product.revenue)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section
            aria-labelledby="ai-performance-title"
            className="rounded-2xl border border-zinc-200 bg-white px-5 py-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950"
          >
            <h2
              id="ai-performance-title"
              className="text-lg font-semibold tracking-tight"
            >
              🤖 Hiệu quả AI
            </h2>

            <dl className="mt-4 grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2.5 dark:border-zinc-700 dark:bg-zinc-900/60">
                <dt className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                  Hội thoại có AI
                </dt>
                <dd className="mt-1 text-2xl font-bold tracking-tight tabular-nums">
                  {stats.ai.conversations}
                </dd>
              </div>
              <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2.5 dark:border-zinc-700 dark:bg-zinc-900/60">
                <dt className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                  Hội thoại ban đêm
                </dt>
                <dd className="mt-1 text-2xl font-bold tracking-tight tabular-nums">
                  {stats.ai.nightConversations}
                </dd>
              </div>
              <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2.5 dark:border-zinc-700 dark:bg-zinc-900/60">
                <dt className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                  Thời gian trả lời TB
                </dt>
                <dd className="mt-1 text-2xl font-bold tracking-tight tabular-nums">
                  {stats.ai.avgResponseMs === null
                    ? "—"
                    : `${secondsFormatter.format(stats.ai.avgResponseMs / 1000)} giây`}
                </dd>
              </div>
            </dl>

            <h3 className="mt-5 text-sm font-semibold tracking-tight">
              Câu hỏi phổ biến
            </h3>
            {stats.ai.topQuestions.length === 0 ? (
              <p className="mt-2 rounded-xl border border-dashed border-zinc-300 px-4 py-6 text-center text-sm text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">
                Chưa có câu hỏi nào trong khoảng này
              </p>
            ) : (
              <ol className="mt-2 divide-y divide-zinc-100 dark:divide-zinc-800">
                {stats.ai.topQuestions.map((question, index) => (
                  <li
                    key={question.text}
                    className="flex items-start justify-between gap-3 py-2 text-sm"
                  >
                    <span className="min-w-0">
                      <span className="mr-2 font-semibold text-zinc-400 tabular-nums dark:text-zinc-500">
                        {index + 1}.
                      </span>
                      {question.text}
                    </span>
                    <span className="shrink-0 rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-semibold text-zinc-600 tabular-nums dark:bg-zinc-800 dark:text-zinc-300">
                      {question.count} lần
                    </span>
                  </li>
                ))}
              </ol>
            )}

            <p className="mt-4 text-xs text-zinc-500 dark:text-zinc-400">
              Số liệu trong khoảng đang chọn, đọc trực tiếp từ DB.
            </p>
          </section>
        </div>
      </main>
    </>
  );
}
