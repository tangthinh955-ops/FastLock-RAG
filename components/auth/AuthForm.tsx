"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

/**
 * Form đăng nhập/đăng ký dùng chung (client component).
 * - Validate nhanh phía client để báo lỗi tiếng Việt ngay, server vẫn validate lại.
 * - Gọi route handlers `/api/auth/*`; thành công thì cookie phiên đã được set
 *   (httpOnly, phía server) nên chỉ cần điều hướng theo vai trò.
 * - Riêng chế độ login có 2 nút "đăng nhập nhanh" cho buổi demo (spec §8.7).
 */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const inputClass =
  "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100";

export default function AuthForm({ mode }: { mode: "login" | "register" }) {
  const router = useRouter();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [demoPending, setDemoPending] = useState<"buyer" | "seller1" | null>(
    null,
  );
  const busy = pending || demoPending !== null;

  /** Sau khi có cookie phiên: BUYER về trang chủ, SELLER vào Studio. */
  function goAfterLogin(role: string | undefined) {
    router.push(role === "SELLER" ? "/seller/studio" : "/");
    // refresh để lần render kế tiếp đọc cookie mới thay vì bản đã cache.
    router.refresh();
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (mode === "register" && name.trim() === "") {
      setError("Vui lòng nhập tên");
      return;
    }
    if (!EMAIL_RE.test(email.trim())) {
      setError("Email không hợp lệ");
      return;
    }
    if (password.length < 6) {
      setError("Mật khẩu phải có ít nhất 6 ký tự");
      return;
    }

    setPending(true);
    try {
      const response = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          mode === "register"
            ? { name: name.trim(), email: email.trim(), password }
            : { email: email.trim(), password },
        ),
      });
      const data = (await response.json().catch(() => null)) as {
        error?: string;
        role?: string;
      } | null;

      if (!response.ok) {
        setError(data?.error ?? "Có lỗi xảy ra, vui lòng thử lại");
        return;
      }

      goAfterLogin(data?.role);
    } catch {
      setError("Không kết nối được máy chủ, vui lòng thử lại");
    } finally {
      setPending(false);
    }
  }

  async function handleDemoLogin(as: "buyer" | "seller1") {
    setError(null);
    setDemoPending(as);
    try {
      const response = await fetch("/api/auth/demo-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ as }),
      });
      const data = (await response.json().catch(() => null)) as {
        error?: string;
        role?: string;
      } | null;

      if (!response.ok) {
        setError(data?.error ?? "Đăng nhập nhanh không thành công");
        return;
      }

      goAfterLogin(data?.role);
    } catch {
      setError("Không kết nối được máy chủ, vui lòng thử lại");
    } finally {
      setDemoPending(null);
    }
  }

  return (
    <div className="w-full rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
      <h1 className="text-2xl font-semibold tracking-tight">
        {mode === "login" ? "Đăng nhập" : "Tạo tài khoản"}
      </h1>
      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
        LiveOrder — demo livestream bán hàng
      </p>

      <form className="mt-6 flex flex-col gap-4" onSubmit={handleSubmit} noValidate>
        {mode === "register" && (
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Tên của bạn
            <input
              className={inputClass}
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Ví dụ: Nguyễn Văn A"
              autoComplete="name"
              disabled={busy}
            />
          </label>
        )}

        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Email
          <input
            className={inputClass}
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="ban@example.com"
            autoComplete="email"
            disabled={busy}
          />
        </label>

        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Mật khẩu
          <input
            className={inputClass}
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Ít nhất 6 ký tự"
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            disabled={busy}
          />
        </label>

        {error && (
          <p
            role="alert"
            className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300"
          >
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="mt-1 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending
            ? "Đang xử lý…"
            : mode === "login"
              ? "Đăng nhập"
              : "Tạo tài khoản"}
        </button>
      </form>

      {mode === "login" && (
        <div className="mt-6 border-t border-zinc-200 pt-5 dark:border-zinc-800">
          <p className="text-xs font-medium tracking-wide text-zinc-500 uppercase dark:text-zinc-400">
            Đăng nhập nhanh (demo)
          </p>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => handleDemoLogin("buyer")}
              disabled={busy}
              className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:hover:bg-zinc-900"
            >
              {demoPending === "buyer" ? "Đang vào…" : "👤 Khách demo"}
            </button>
            <button
              type="button"
              onClick={() => handleDemoLogin("seller1")}
              disabled={busy}
              className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:hover:bg-zinc-900"
            >
              {demoPending === "seller1" ? "Đang vào…" : "🏪 Shop demo"}
            </button>
          </div>
          <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
            Buổi demo nên mở 2 cửa sổ: một thường (Shop) và một ẩn danh (Khách)
            — cookie phiên dùng chung cho mọi tab cùng profile.
          </p>
        </div>
      )}
    </div>
  );
}
