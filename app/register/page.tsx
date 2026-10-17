import type { Metadata } from "next";
import Link from "next/link";
import AuthForm from "@/components/auth/AuthForm";

export const metadata: Metadata = { title: "Đăng ký — LiveOrder Demo" };

export default function RegisterPage() {
  return (
    <main className="flex flex-1 items-center justify-center px-6 py-16">
      <div className="w-full max-w-sm">
        <AuthForm mode="register" />
        <p className="mt-4 text-center text-sm text-zinc-600 dark:text-zinc-400">
          Đã có tài khoản?{" "}
          <Link
            href="/login"
            className="font-medium text-emerald-700 hover:underline dark:text-emerald-400"
          >
            Đăng nhập
          </Link>
        </p>
      </div>
    </main>
  );
}
