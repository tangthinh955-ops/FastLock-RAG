"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import type { TokenPayload } from "@/lib/auth/token";

const ROLE_LABEL: Record<TokenPayload["role"], string> = {
  BUYER: "Khách",
  SELLER: "Shop",
};

/** Điều hướng 6 màn hình của người bán (Plan 3 T6). */
const SELLER_NAV_ITEMS = [
  { href: "/seller", label: "📊 Dashboard" },
  { href: "/seller/studio", label: "🎥 Studio" },
  { href: "/seller/inbox", label: "💬 Inbox" },
  { href: "/seller/products", label: "🛍️ Sản phẩm" },
  { href: "/seller/kb", label: "📚 KB" },
  { href: "/seller/orders", label: "🧾 Đơn" },
] as const;

const NAV_LINK_CLASS =
  "shrink-0 whitespace-nowrap rounded-lg border px-2.5 py-1 text-xs font-medium transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600";
const NAV_LINK_IDLE_CLASS =
  "border-zinc-300 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900";
const NAV_LINK_ACTIVE_CLASS =
  "border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-700 dark:border-emerald-500 dark:bg-emerald-600 dark:hover:bg-emerald-700";

/**
 * Dashboard chỉ active khi đúng `/seller`; các màn con active cả khi ở URL sâu
 * hơn (ví dụ `/seller/orders?...`). `startsWith` cần ranh giới `/` để
 * `/seller/products-x` không bị coi là `/seller/products`.
 */
function isNavItemActive(pathname: string, href: string): boolean {
  if (href === "/seller") {
    return pathname === "/seller";
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Header mảnh của Trang chủ (client component duy nhất của Task 12 — được
 * brief cho phép) vì cần nút Đăng xuất gọi `POST /api/auth/logout`.
 *
 * Tài khoản do server component `app/page.tsx` xác thực từ cookie rồi truyền
 * xuống; component này không đọc/giữ token — đúng luật "danh tính chỉ từ JWT"
 * và tránh lộ token vào client bundle.
 */
export default function HomeHeader({ user }: { user: TokenPayload | null }) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleLogout() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/logout", { method: "POST" });
      if (!response.ok) {
        // Route logout idempotent (200 khi tới được server): lỗi ở đây nghĩa
        // là cookie phiên có thể vẫn còn — báo lỗi thay vì giả vờ đã ra.
        setError("Không đăng xuất được, vui lòng thử lại");
        return;
      }
      router.push("/");
      router.refresh();
    } catch {
      setError("Không đăng xuất được, vui lòng thử lại");
    } finally {
      setPending(false);
    }
  }

  return (
    <header className="sticky top-0 z-10 border-b border-zinc-200 bg-white/80 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/80">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-6 py-3">
        <Link
          href="/"
          className="flex items-center gap-2.5 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-emerald-600"
        >
          <span className="grid size-8 place-items-center rounded-lg bg-emerald-600 text-sm font-bold text-white">
            L
          </span>
          <span className="text-lg font-semibold tracking-tight">LiveOrder</span>
        </Link>

        {user ? (
          <div className="flex min-w-0 flex-col items-end gap-1">
            <div className="flex min-w-0 max-w-full flex-wrap items-center justify-end gap-x-3 gap-y-1 text-sm">
              <span
                className="min-w-0 max-w-[12rem] truncate font-medium"
                title={user.name}
              >
                {user.name}
              </span>
              <span className="shrink-0 rounded-full bg-zinc-100 px-2.5 py-0.5 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                {ROLE_LABEL[user.role]}
              </span>
              {user.role === "BUYER" && (
                <>
                  {/* Điểm vào hai trang của khách (Task 9 + Plan 3 T1): seller có
                      inbox riêng ở /seller/inbox nên không hiện ở đây. */}
                  <Link
                    href="/orders"
                    className="shrink-0 rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium transition hover:bg-zinc-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 dark:border-zinc-700 dark:hover:bg-zinc-900"
                  >
                    🧾 Đơn của tôi
                  </Link>
                  <Link
                    href="/inbox"
                    className="shrink-0 rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium transition hover:bg-zinc-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 dark:border-zinc-700 dark:hover:bg-zinc-900"
                  >
                    💬 Inbox
                  </Link>
                </>
              )}
              <button
                type="button"
                onClick={handleLogout}
                disabled={pending}
                className="shrink-0 rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:hover:bg-zinc-900"
              >
                {pending ? "Đang xuất…" : "Đăng xuất"}
              </button>
            </div>
            {user.role === "SELLER" && (
              <nav
                aria-label="Điều hướng người bán"
                className="flex w-full max-w-full flex-wrap items-center justify-end gap-1.5"
              >
                {SELLER_NAV_ITEMS.map((item) => {
                  const active = isNavItemActive(pathname, item.href);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      className={`${NAV_LINK_CLASS} ${
                        active ? NAV_LINK_ACTIVE_CLASS : NAV_LINK_IDLE_CLASS
                      }`}
                    >
                      {item.label}
                    </Link>
                  );
                })}
              </nav>
            )}
            {error !== null && (
              <p role="alert" className="text-xs text-red-600 dark:text-red-400">
                {error}
              </p>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-2 text-sm">
            <Link
              href="/login"
              className="rounded-lg px-3 py-1.5 font-medium text-zinc-600 transition hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-900"
            >
              Đăng nhập
            </Link>
            <Link
              href="/register"
              className="rounded-lg bg-emerald-600 px-3 py-1.5 font-medium text-white transition hover:bg-emerald-700"
            >
              Đăng ký
            </Link>
          </div>
        )}
      </div>
    </header>
  );
}
