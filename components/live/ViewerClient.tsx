"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import ChatOverlay from "@/components/live/ChatOverlay";
import CommentInput from "@/components/live/CommentInput";
import ConsultButton from "@/components/live/ConsultButton";
import MyOrderCard from "@/components/live/MyOrderCard";
import OrderToast from "@/components/live/OrderToast";
import { useLiveSocket } from "@/hooks/useLiveSocket";

type ViewerClientProps = {
  token: string | null;
  userId: string | null;
  userName: string | null;
  session: { id: string; title: string; status: "LIVE" | "ENDED" };
  shop: { id: string; name: string };
  /** Server đã biết phiên ENDED — banner phải hiện ngay từ HTML đầu tiên. */
  initialEnded: boolean;
};

/** Tối đa 3 toast trên màn hình — đủ cho kịch bản demo, không che stage. */
const MAX_TOASTS = 3;

/**
 * Chữ cái đại diện của shop: lấy từ đầu, riêng tiền tố "Shop" (không phân biệt
 * hoa thường) bị bỏ qua và lấy từ cuối — "Shop Thời Trang Linh" → "L",
 * "Shop Áo Sơ Mi Bảo An" → "A"; tên rỗng → "?".
 */
function shopInitial(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const first = words[0];
  if (first === undefined) {
    return "?";
  }
  const word =
    first.toLocaleLowerCase("vi") === "shop"
      ? words[words.length - 1]
      : first;
  return word.charAt(0).toLocaleUpperCase("vi") || "?";
}

/**
 * Màn xem live kiểu TikTok (mockup Option B, spec §5.2): stage tối 16:9 làm
 * "video", chat nổi dưới-trái, toast đơn của chính mình, thẻ đơn cá nhân và
 * nút Tư vấn.
 *
 * Trạng thái:
 * - Khách ẩn danh: `token = null` → hook không mở socket; chat chỉ hiện lời
 *   mời đăng nhập, không Tư vấn/đơn/toast.
 * - Phiên ENDED: banner hiện ngay nhờ `initialEnded` (từ server) và thêm khi
 *   `live_ended` tới giữa phiên; input bị thay bằng thông báo.
 * - Toast: chỉ đơn có `buyerId === userId`, lấy tối đa 3 đơn mới nhất chưa bị
 *   tắt; mỗi toast tự hết hạn sau 5s ở `OrderToast`.
 */
export default function ViewerClient({
  token,
  userId,
  userName,
  session,
  shop,
  initialEnded,
}: ViewerClientProps) {
  // Phiên đã ENDED từ server: không cần mở socket/join phòng nào. `loggedIn`
  // vẫn dựa trên `token` gốc để giữ đúng nút Tư vấn/thẻ đơn của người dùng.
  const socketToken = initialEnded ? null : token;
  const { comments, orders, viewers, ended, sendComment } = useLiveSocket(
    socketToken,
    initialEnded ? null : session.id,
  );

  const isEnded = initialEnded || ended;
  const loggedIn = token !== null && userId !== null;

  const ownOrders = loggedIn
    ? orders.filter((entry) => entry.buyerId === userId)
    : [];

  const [dismissedToastIds, setDismissedToastIds] = useState<
    ReadonlySet<string>
  >(() => new Set());
  const dismissToast = useCallback((orderId: string) => {
    setDismissedToastIds((previous) => {
      if (previous.has(orderId)) {
        return previous;
      }
      const next = new Set(previous);
      next.add(orderId);
      return next;
    });
  }, []);

  // Chỉ 3 đơn mới nhất được phép hiện toast. Đơn cũ hơn (index ≥ 3) không bao
  // giờ trồi lên sau khi toast khác tắt — tránh "toast cũ bỗng xuất hiện".
  const toastOrders = loggedIn
    ? ownOrders
        .slice(0, MAX_TOASTS)
        .filter((entry) => !dismissedToastIds.has(entry.order.id))
    : [];

  return (
    <main className="flex min-h-svh flex-1 flex-col bg-zinc-950 px-2 py-3 text-white sm:px-4 sm:py-5">
      <section
        aria-label={`Livestream của ${shop.name}`}
        className="relative isolate mx-auto flex min-h-[560px] w-full max-w-6xl flex-1 flex-col overflow-hidden rounded-[1.75rem] border border-white/10 bg-[#0d0e12] shadow-2xl lg:min-h-[640px]"
      >
        {/* "Video" minh họa: gradient tối + tên shop mờ làm nền stage. */}
        <div
          aria-hidden
          className="absolute inset-0 bg-gradient-to-br from-zinc-950 via-zinc-900 to-emerald-950"
        />
        <div
          aria-hidden
          className="absolute inset-0 opacity-70 [background:radial-gradient(circle_at_18%_8%,rgba(16,185,129,0.16),transparent_42%),radial-gradient(circle_at_82%_16%,rgba(244,63,94,0.12),transparent_40%)]"
        />

        <header className="absolute inset-x-0 top-0 z-30 flex items-start justify-between gap-3 bg-gradient-to-b from-black/70 to-transparent p-3 sm:p-5">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Link
              href="/"
              className="rounded-lg bg-black/45 px-2.5 py-1.5 text-xs font-medium text-white/85 backdrop-blur transition hover:bg-black/70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400"
            >
              ← Trang chủ
            </Link>

            {isEnded ? (
              <span className="inline-flex items-center rounded-md bg-zinc-700/85 px-2.5 py-1 text-xs font-bold tracking-wide text-white shadow-sm">
                Đã kết thúc
              </span>
            ) : (
              <span
                aria-label={`Đang phát trực tiếp, ${viewers ?? "chưa rõ"} người xem`}
                className="inline-flex items-center gap-1.5 rounded-md bg-rose-600 px-2.5 py-1 text-xs font-bold tracking-wide text-white shadow-sm"
              >
                <span aria-hidden className="animate-pulse">
                  ●
                </span>
                LIVE · 👀 {viewers ?? "—"}
              </span>
            )}

            {loggedIn && userName !== null && (
              <span className="hidden text-xs text-white/50 sm:inline">
                Chào {userName}
              </span>
            )}
          </div>

          {loggedIn && <ConsultButton shopId={shop.id} />}
        </header>

        {isEnded && (
          <div
            role="status"
            className="absolute inset-x-0 top-16 z-20 mx-auto w-fit max-w-[calc(100%-1.5rem)] rounded-full border border-amber-300/40 bg-amber-500/15 px-4 py-2 text-center text-sm font-medium text-amber-100 backdrop-blur"
          >
            <strong className="font-semibold">Live đã kết thúc.</strong>{" "}
            Cảm ơn bạn đã theo dõi phiên live này.
          </div>
        )}

        <div className="relative z-10 flex flex-1 flex-col items-center justify-center px-6 pt-24 pb-10 text-center">
          <span
            aria-hidden
            className="absolute text-[42vw] leading-none font-black text-white/[0.04] select-none sm:text-[24vw] lg:text-[16rem]"
          >
            {shopInitial(shop.name)}
          </span>
          <p className="relative text-[11px] font-semibold tracking-[0.28em] text-white/40 uppercase">
            Livestream
          </p>
          <h1 className="relative mt-2 max-w-2xl text-3xl font-semibold tracking-tight text-balance sm:text-5xl">
            {shop.name}
          </h1>
          <p className="relative mt-2 max-w-xl text-sm text-white/70 sm:text-base">
            {session.title}
          </p>
          <p className="relative mt-6 rounded-full border border-white/10 bg-black/25 px-3 py-1 text-[11px] text-white/40">
            (video minh họa)
          </p>
        </div>

        <div className="relative z-10 mx-3 mb-2 sm:mx-4 lg:absolute lg:bottom-24 lg:left-5 lg:mb-0 lg:w-[55%] lg:max-w-2xl">
          <ChatOverlay
            comments={loggedIn ? comments : []}
            anonymous={!loggedIn}
            ended={isEnded}
          />
        </div>

        {loggedIn && ownOrders.length > 0 && (
          <div className="relative z-10 mx-3 mb-2 flex justify-end sm:mx-4 lg:absolute lg:right-5 lg:bottom-24 lg:mb-0 lg:w-64">
            <MyOrderCard orders={ownOrders} />
          </div>
        )}

        <div className="relative z-20 mt-auto bg-gradient-to-t from-black via-black/75 to-transparent px-3 pt-10 pb-3 sm:px-4 sm:pb-4">
          <CommentInput
            comments={comments}
            userId={userId ?? ""}
            sessionId={session.id}
            sendComment={sendComment}
            ended={isEnded}
            anonymous={!loggedIn}
          />
        </div>

        {toastOrders.length > 0 && (
          <div className="pointer-events-none absolute top-20 right-3 z-30 flex w-[min(20rem,calc(100%-1.5rem))] flex-col gap-2 sm:right-5">
            {toastOrders.map(({ order }) => (
              <OrderToast
                key={order.id}
                order={order}
                onDismiss={dismissToast}
              />
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
