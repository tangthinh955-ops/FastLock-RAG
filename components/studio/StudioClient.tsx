"use client";

import { useState, type FormEvent } from "react";
import type { TokenPayload } from "@/lib/auth/token";
import EndLiveDialog, {
  type LiveEndSummary,
} from "@/components/studio/EndLiveDialog";
import EngineLogStrip from "@/components/studio/EngineLogStrip";
import LiveCommentFeed from "@/components/studio/LiveCommentFeed";
import LiveOrderPanel from "@/components/studio/LiveOrderPanel";
import WebcamPreview from "@/components/studio/WebcamPreview";
import { useLiveSocket } from "@/hooks/useLiveSocket";

type ActiveSession = { id: string; title: string };

type StartResponse = {
  session?: { id: string; title: string; shopName: string };
  error?: string;
};

type EndResponse = {
  summary?: LiveEndSummary;
  error?: string;
};

type StudioClientProps = {
  token: string;
  user: TokenPayload;
  shopName: string;
  productCount: number;
  activeSession: ActiveSession | null;
  demoMode: boolean;
};

/**
 * Studio seller (Task 13) — bộ điều phối client:
 * - chưa LIVE: form bắt đầu (disable khi đang gửi để chống double-click race T11)
 * - đang LIVE: webcam + feed comment + đơn nổ + log, nút giả lập khách (DEMO_MODE)
 * - kết thúc: gọi REST end → dialog tổng kết; đóng dialog thì về form bắt đầu
 *   mới ngay, KHÔNG reload trang (state phiên về null, hook tự join phiên mới).
 */
export default function StudioClient({
  token,
  user,
  shopName,
  productCount,
  activeSession,
  demoMode,
}: StudioClientProps) {
  const [session, setSession] = useState<ActiveSession | null>(activeSession);
  const [startTitle, setStartTitle] = useState("");
  const [startPending, setStartPending] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [endPending, setEndPending] = useState(false);
  const [endError, setEndError] = useState<string | null>(null);
  const [summary, setSummary] = useState<LiveEndSummary | null>(null);
  const [fakeEnabled, setFakeEnabled] = useState(activeSession !== null);

  const { comments, orders, viewers, ended, connected, toggleFake } =
    useLiveSocket(token, session?.id ?? null);

  const live = session !== null;
  const showLiveStage = live && summary === null && !ended;
  const canToggleFake = demoMode && live && summary === null && !ended;

  async function handleStart(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (startPending) return;

    setStartError(null);
    if (startTitle.trim() === "") {
      setStartError("Vui lòng nhập tiêu đề live");
      return;
    }

    setStartPending(true);
    try {
      const response = await fetch("/api/seller/live/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: startTitle.trim() }),
      });
      const data = (await response.json().catch(() => null)) as
        | StartResponse
        | null;

      if (!response.ok || !data?.session) {
        setStartError(
          data?.error ?? "Không bắt đầu được live, vui lòng thử lại",
        );
        return;
      }

      setSession({ id: data.session.id, title: data.session.title });
      setStartTitle("");
      setFakeEnabled(true);
      setSummary(null);
      setEndError(null);
    } catch {
      setStartError("Không kết nối được máy chủ, vui lòng thử lại");
    } finally {
      setStartPending(false);
    }
  }

  async function handleEnd() {
    if (endPending || !live) return;

    setEndError(null);
    setEndPending(true);
    try {
      const response = await fetch("/api/seller/live/end", { method: "POST" });
      const data = (await response.json().catch(() => null)) as
        | EndResponse
        | null;

      if (!response.ok || !data?.summary) {
        // 409/404 từ T11 (double-end, phiên đã kết thúc) — hiện đúng message
        // tiếng Việt của server, không tự đoán trạng thái.
        setEndError(data?.error ?? "Không kết thúc được live, vui lòng thử lại");
        return;
      }

      setSummary(data.summary);
      // REST end đã stop fake comments phía server; phản ánh ngay trên UI.
      setFakeEnabled(false);
    } catch {
      setEndError("Không kết nối được máy chủ, vui lòng thử lại");
    } finally {
      setEndPending(false);
    }
  }

  /** Đóng popup tổng kết → về form bắt đầu mới, không reload trang. */
  function handleCloseSummary() {
    setSummary(null);
    setSession(null);
    setFakeEnabled(false);
    setEndError(null);
  }

  /** Phiên bị kết thúc từ tab khác (hook báo `live_ended`) → cho mở phiên mới. */
  function handleStartNewAfterEnd() {
    setSummary(null);
    setSession(null);
    setFakeEnabled(false);
    setEndError(null);
  }

  function handleToggleFake() {
    const next = !fakeEnabled;
    setFakeEnabled(next);
    toggleFake(next);
  }

  return (
    <main className="mx-auto w-full max-w-7xl flex-1 px-6 pt-8 pb-10">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              Studio — {shopName}
            </h1>
            {live && (
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
                  connected
                    ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400"
                    : "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400"
                }`}
              >
                <span
                  aria-hidden
                  className={`size-1.5 rounded-full ${
                    connected
                      ? "bg-emerald-500"
                      : "animate-pulse bg-amber-500"
                  }`}
                />
                {connected ? "Đã kết nối" : "Đang kết nối…"}
              </span>
            )}
          </div>
          <p className="mt-1.5 text-sm text-zinc-600 dark:text-zinc-400">
            {live
              ? `Chào ${user.name} — đơn sẽ nổ ngay khi khách gõ mã SKU trong comment.`
              : `Chào ${user.name} — ${productCount} sản phẩm sẵn sàng, mở sóng để nhận comment và chốt đơn realtime.`}
          </p>
        </div>

        {canToggleFake && (
          <button
            type="button"
            onClick={handleToggleFake}
            aria-pressed={fakeEnabled}
            className={`rounded-lg border px-3.5 py-2 text-sm font-medium transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 ${
              fakeEnabled
                ? "border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300 dark:hover:bg-emerald-950/70"
                : "border-zinc-300 bg-white text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
            }`}
          >
            🎭 Giả lập khách: {fakeEnabled ? "Bật" : "Tắt"}
          </button>
        )}
      </div>

      {ended && summary === null && (
        <div
          role="status"
          className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
        >
          <span>
            <strong>Live đã kết thúc.</strong> Phiên này không còn nhận comment
            hay đơn mới.
          </span>
          <button
            type="button"
            onClick={handleStartNewAfterEnd}
            className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-amber-700"
          >
            Bắt đầu live mới
          </button>
        </div>
      )}

      {endError !== null && (
        <p
          role="alert"
          className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
        >
          {endError}
        </p>
      )}

      {session === null ? (
        <section className="mt-6 overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
          <div className="bg-gradient-to-br from-emerald-600 via-emerald-700 to-emerald-900 px-6 py-7 text-white">
            <p className="text-xs font-semibold tracking-[0.18em] text-emerald-100 uppercase">
              Sẵn sàng lên sóng
            </p>
            <h2 className="mt-1.5 text-2xl font-semibold tracking-tight">
              Bắt đầu phiên live
            </h2>
            <p className="mt-1.5 max-w-2xl text-sm text-emerald-50/90">
              Mở webcam preview, để hệ thống tự bắt mã SKU trong comment và
              đẩy đơn nổ về panel bên phải.
            </p>
          </div>

          <form
            onSubmit={handleStart}
            className="flex flex-col gap-3 px-6 py-5"
            noValidate
          >
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              Tiêu đề live
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  type="text"
                  value={startTitle}
                  onChange={(event) => setStartTitle(event.target.value)}
                  placeholder="Đại hội áo thun — giảm 20% hôm nay!"
                  disabled={startPending}
                  maxLength={120}
                  className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:ring-emerald-900"
                />
                <button
                  type="submit"
                  disabled={startPending}
                  className="shrink-0 rounded-lg bg-emerald-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {startPending ? "Đang bắt đầu…" : "Bắt đầu live"}
                </button>
              </div>
            </label>

            {startError !== null && (
              <p
                role="alert"
                className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300"
              >
                {startError}
              </p>
            )}
          </form>

          <div className="grid gap-3 border-t border-zinc-200 px-6 py-5 sm:grid-cols-3 dark:border-zinc-800">
            {[
              {
                icon: "📷",
                title: "Webcam preview",
                text: "Chỉ hiển thị trong Studio của bạn, không phát cho khách.",
              },
              {
                icon: "⚙️",
                title: "Aho-Corasick",
                text: `Theo dõi ${productCount} mã SKU và đo thời gian bắt thật.`,
              },
              {
                icon: "🧾",
                title: "Đơn nổ realtime",
                text: "Comment hợp lệ tạo đơn ngay, trừ kho nguyên tử.",
              },
            ].map((feature) => (
              <div
                key={feature.title}
                className="rounded-xl border border-zinc-200 bg-zinc-50 px-3.5 py-3 dark:border-zinc-800 dark:bg-zinc-900/50"
              >
                <p className="text-lg" aria-hidden>
                  {feature.icon}
                </p>
                <p className="mt-1 text-sm font-semibold">{feature.title}</p>
                <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                  {feature.text}
                </p>
              </div>
            ))}
          </div>
        </section>
      ) : (
        <div className="mt-5 grid grid-cols-1 gap-5 lg:h-[calc(100vh-13rem)] lg:min-h-[540px] lg:grid-cols-[1.55fr_1fr]">
          <div className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
            <div className="relative aspect-video min-h-[260px] bg-[#101014] lg:aspect-auto lg:flex-1">
              {showLiveStage ? (
                <WebcamPreview />
              ) : (
                <div className="absolute inset-0 grid place-items-center p-6 text-center text-zinc-400">
                  <div>
                    <p className="text-5xl" aria-hidden>
                      📴
                    </p>
                    <p className="mt-3 text-base font-semibold text-zinc-200">
                      Live đã kết thúc
                    </p>
                    <p className="mt-1 text-sm text-zinc-500">
                      {summary !== null
                        ? "Đóng bảng tổng kết để mở phiên mới."
                        : "Bấm “Bắt đầu live mới” phía trên để lên sóng lại."}
                    </p>
                  </div>
                </div>
              )}

              {showLiveStage && (
                <>
                  <span className="absolute top-3 left-3 inline-flex items-center gap-1.5 rounded-md bg-rose-600 px-2.5 py-1 text-xs font-bold tracking-wide text-white shadow-sm">
                    <span
                      aria-hidden
                      className="size-1.5 animate-pulse rounded-full bg-white"
                    />
                    LIVE · 👀 {viewers ?? "—"}
                  </span>

                  <button
                    type="button"
                    onClick={handleEnd}
                    disabled={endPending}
                    className="absolute top-3 right-3 rounded-md border border-white/20 bg-black/45 px-3 py-1.5 text-xs font-semibold text-white backdrop-blur transition hover:bg-rose-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {endPending ? "Đang kết thúc…" : "■ Kết thúc live"}
                  </button>

                  <div className="absolute inset-x-3 bottom-3 rounded-lg bg-black/60 px-3 py-2 text-xs text-white backdrop-blur sm:text-sm">
                    <span className="text-white/70">📣 Tiêu đề live:</span>{" "}
                    <strong className="font-semibold">{session.title}</strong>
                  </div>
                </>
              )}
            </div>

            <EngineLogStrip productCount={productCount} comments={comments} />
          </div>

          <div className="grid min-h-0 gap-5 lg:grid-rows-[1.1fr_0.9fr]">
            <LiveCommentFeed comments={comments} />
            <LiveOrderPanel orders={orders} />
          </div>
        </div>
      )}

      {summary !== null && (
        <EndLiveDialog summary={summary} onClose={handleCloseSummary} />
      )}
    </main>
  );
}
