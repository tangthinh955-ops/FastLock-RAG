"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { TokenPayload } from "@/lib/auth/token";

const ROLE_LABEL: Record<TokenPayload["role"], string> = {
  BUYER: "Khách",
  SELLER: "Shop",
};

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
  const [pending, setPending] = useState(false);

  async function handleLogout() {
    setPending(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      // Dù request lỗi, đưa người dùng về trạng thái khách và render lại để
      // header đọc cookie mới (đồng pattern với AuthForm sau khi đăng nhập).
      router.push("/");
      router.refresh();
      setPending(false);
    }
  }

  return (
    <header className="sticky top-0 z-10 border-b border-zinc-200 bg-white/80 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/80">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-6 py-3">
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
          <div className="flex items-center gap-3 text-sm">
            <span className="font-medium">{user.name}</span>
            <span className="rounded-full bg-zinc-100 px-2.5 py-0.5 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
              {ROLE_LABEL[user.role]}
            </span>
            <button
              type="button"
              onClick={handleLogout}
              disabled={pending}
              className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:hover:bg-zinc-900"
            >
              {pending ? "Đang xuất…" : "Đăng xuất"}
            </button>
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
