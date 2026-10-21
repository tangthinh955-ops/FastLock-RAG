import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { redirect, unstable_rethrow } from "next/navigation";
import HomeHeader from "@/components/home/HomeHeader";
import PayButton from "@/components/orders/PayButton";
import { requireUser } from "@/lib/auth/guards";
import { ApiError } from "@/lib/auth/service";
import type { TokenPayload } from "@/lib/auth/token";
import { prisma } from "@/lib/db";
import { demoBankInfo, paymentQrContent, renderQrDataUrl } from "@/lib/orders/qr";
import {
  listBuyerOrders,
  type OrderWithRefs,
} from "@/lib/orders/service";

export const metadata: Metadata = { title: "Đơn của tôi — LiveOrder Demo" };

/**
 * Trang "Đơn của tôi" của khách (Plan 3 Task 1 — spec §5.4, §8.3): danh sách
 * đơn + chi tiết, QR giả lập cho đơn PENDING và nút "Giả lập đã chuyển khoản".
 *
 * Đọc cookie phiên + DB nên luôn render theo request (`instant = false`, cùng
 * lý do với `/` và `/inbox`); guard thật nằm ở đây, proxy chỉ là lớp lạc quan.
 * Không cần token/socket ở trang này — mọi thay đổi đi qua REST pay rồi
 * `router.refresh()`.
 */
export const instant = false;

const priceFormatter = new Intl.NumberFormat("vi-VN", {
  maximumFractionDigits: 0,
});
const dateTimeFormatter = new Intl.DateTimeFormat("vi-VN", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function formatVnd(value: number): string {
  return `${priceFormatter.format(value)}đ`;
}

const STATUS_META: Record<
  OrderWithRefs["status"],
  { label: string; badge: string; banner: string }
> = {
  PENDING: {
    label: "Chờ thanh toán",
    badge:
      "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300",
    banner:
      "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200",
  },
  PAID: {
    label: "Đã thanh toán",
    badge:
      "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300",
    banner:
      "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-200",
  },
  SHIPPED: {
    label: "Đã giao",
    badge: "bg-sky-100 text-sky-800 dark:bg-sky-950/60 dark:text-sky-300",
    banner:
      "border-sky-200 bg-sky-50 text-sky-900 dark:border-sky-900/60 dark:bg-sky-950/40 dark:text-sky-200",
  },
  CANCELLED: {
    label: "Đã huỷ",
    badge: "bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-300",
    banner:
      "border-red-200 bg-red-50 text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200",
  },
};

const STATUS_NOTE: Record<OrderWithRefs["status"], string> = {
  PENDING: "Đơn đang chờ thanh toán — quét QR hoặc bấm nút giả lập bên dưới.",
  PAID: "✅ Shop đã nhận thanh toán và sẽ chuẩn bị hàng ngay.",
  SHIPPED: "📦 Đơn đã được giao cho khách.",
  CANCELLED: "Đơn đã bị huỷ — không cần thanh toán.",
};

type OrdersPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function OrdersPage({ searchParams }: OrdersPageProps) {
  // Guard thật: chưa đăng nhập → /login; seller vào nhầm → /seller/inbox
  // (trang seller tương ứng, cùng đích đến với `/inbox`).
  let user: TokenPayload | null = null;
  try {
    user = await requireUser("BUYER");
  } catch (error) {
    // `requireUser` gọi `cookies()` — lỗi bail-out của Next phải để Next xử lý.
    unstable_rethrow(error);
    if (error instanceof ApiError && error.status === 403) {
      redirect("/seller/inbox");
    }
    redirect("/login");
  }

  if (user === null) {
    redirect("/login");
  }

  const orders = await listBuyerOrders(prisma, user.userId);

  // `?order=` chỉ có hiệu lực khi đơn thuộc buyer; id lạ/rỗng → đơn mới nhất.
  const rawOrder = (await searchParams).order;
  const requestedId =
    typeof rawOrder === "string" && rawOrder !== "" ? rawOrder : null;
  const selected =
    (requestedId === null
      ? null
      : orders.find((order) => order.id === requestedId)) ??
    orders[0] ??
    null;

  // QR chỉ sinh cho đơn PENDING — trang server component, `qrcode` không vào
  // bundle client. Đơn khác không tốn công sinh ảnh.
  const qrDataUrl =
    selected !== null && selected.status === "PENDING"
      ? await renderQrDataUrl(paymentQrContent(selected))
      : null;
  const bank = demoBankInfo();

  return (
    <>
      <HomeHeader user={user} />

      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              🧾 Đơn của tôi
            </h1>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
              Xem lại đơn đã chốt trong live và thanh toán bằng QR giả lập.
            </p>
          </div>
          <Link
            href="/inbox"
            className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium transition hover:bg-zinc-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 dark:border-zinc-700 dark:hover:bg-zinc-900"
          >
            💬 Inbox
          </Link>
        </div>

        {orders.length === 0 || selected === null ? (
          <div className="mt-8 rounded-2xl border border-dashed border-zinc-300 px-6 py-14 text-center dark:border-zinc-700">
            <span
              aria-hidden
              className="grid size-14 place-items-center rounded-2xl bg-emerald-50 text-3xl dark:bg-emerald-950/50 mx-auto"
            >
              🧾
            </span>
            <p className="mx-auto mt-3 max-w-md text-sm text-zinc-600 dark:text-zinc-400">
              Bạn chưa có đơn nào — vào live và gõ mã sản phẩm (vd. SP01 2 cái)
              để chốt đơn.
            </p>
            <Link
              href="/"
              className="mt-4 inline-flex items-center rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
            >
              ← Về trang chủ xem live
            </Link>
          </div>
        ) : (
          <div className="mt-6 grid gap-4 lg:grid-cols-[20rem_minmax(0,1fr)] lg:items-start">
            <nav
              aria-label="Danh sách đơn"
              className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950"
            >
              <ul className="max-h-[32rem] divide-y divide-zinc-100 overflow-y-auto dark:divide-zinc-800">
                {orders.map((order) => {
                  const status = STATUS_META[order.status];
                  const active = order.id === selected.id;
                  return (
                    <li key={order.id}>
                      <Link
                        href={`/orders?order=${order.id}`}
                        aria-current={active ? "page" : undefined}
                        className={`block px-3.5 py-3 transition ${
                          active
                            ? "bg-emerald-50 dark:bg-emerald-950/40"
                            : "hover:bg-zinc-50 dark:hover:bg-zinc-900"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-semibold tabular-nums">
                            #{order.code}
                          </span>
                          <span
                            className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${status.badge}`}
                          >
                            {status.label}
                          </span>
                        </div>
                        <p className="mt-0.5 truncate text-xs text-zinc-600 dark:text-zinc-400">
                          {order.product.name} ×{order.qty}
                        </p>
                        <p className="mt-0.5 text-sm font-semibold text-zinc-900 tabular-nums dark:text-zinc-100">
                          {formatVnd(order.total)}
                        </p>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </nav>

            <section
              aria-label={`Chi tiết đơn #${selected.code}`}
              className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold tracking-tight tabular-nums">
                    Đơn #{selected.code}
                  </h2>
                  <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                    Tạo lúc{" "}
                    {dateTimeFormatter.format(selected.createdAt)}
                  </p>
                </div>
                <span
                  className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${STATUS_META[selected.status].badge}`}
                >
                  {STATUS_META[selected.status].label}
                </span>
              </div>

              <dl className="mt-4 space-y-2 text-sm">
                <div className="flex justify-between gap-3">
                  <dt className="text-zinc-500 dark:text-zinc-400">Shop</dt>
                  <dd className="min-w-0 truncate text-right font-medium">
                    🏪 {selected.shop.name}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-zinc-500 dark:text-zinc-400">Sản phẩm</dt>
                  <dd className="min-w-0 text-right font-medium">
                    {selected.product.name}{" "}
                    <span className="font-normal text-zinc-500 dark:text-zinc-400">
                      ({selected.product.sku})
                    </span>
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-zinc-500 dark:text-zinc-400">
                    Đơn giá × số lượng
                  </dt>
                  <dd className="text-right tabular-nums">
                    {formatVnd(selected.unitPrice)} ×{selected.qty}
                  </dd>
                </div>
                <div className="flex justify-between gap-3 border-t border-zinc-100 pt-2 dark:border-zinc-800">
                  <dt className="font-medium">Tổng tiền</dt>
                  <dd className="text-right font-semibold tabular-nums">
                    {formatVnd(selected.total)}
                  </dd>
                </div>
                {selected.paidAt !== null && (
                  <div className="flex justify-between gap-3">
                    <dt className="text-zinc-500 dark:text-zinc-400">
                      Đã thanh toán lúc
                    </dt>
                    <dd className="text-right tabular-nums">
                      {dateTimeFormatter.format(selected.paidAt)}
                    </dd>
                  </div>
                )}
              </dl>

              <div
                className={`mt-4 rounded-xl border px-3.5 py-2.5 text-sm ${STATUS_META[selected.status].banner}`}
              >
                {STATUS_NOTE[selected.status]}
              </div>

              {selected.status === "PENDING" && qrDataUrl !== null && (
                <div className="mt-4 flex flex-col gap-4 rounded-xl border border-zinc-200 p-4 sm:flex-row sm:items-center dark:border-zinc-800">
                  <Image
                    src={qrDataUrl}
                    alt={`QR giả lập thanh toán đơn #${selected.code}`}
                    width={240}
                    height={240}
                    unoptimized
                    className="mx-auto rounded-lg border border-zinc-200 bg-white p-2 sm:mx-0"
                  />
                  <div className="min-w-0 text-sm">
                    <p className="font-semibold">
                      Quét QR để &ldquo;chuyển khoản&rdquo; (giả lập)
                    </p>
                    <p className="mt-1 text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">
                      Ngân hàng demo {bank.bankId} · STK{" "}
                      <span className="font-medium text-zinc-800 dark:text-zinc-200">
                        {bank.account}
                      </span>{" "}
                      · Chủ TK {bank.owner}
                    </p>
                    <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
                      Nội dung:{" "}
                      <span className="font-mono text-[11px] text-zinc-800 dark:text-zinc-200">
                        {selected.paymentCode}
                      </span>
                    </p>
                    <p className="mt-1 text-xs font-medium text-amber-700 dark:text-amber-400">
                      Chỉ là giao dịch giả lập, không chuyển tiền thật.
                    </p>
                    <div className="mt-3">
                      <PayButton orderId={selected.id} />
                    </div>
                  </div>
                </div>
              )}
            </section>
          </div>
        )}
      </main>
    </>
  );
}
