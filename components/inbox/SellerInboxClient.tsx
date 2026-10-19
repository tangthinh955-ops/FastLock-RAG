"use client";

import Link from "next/link";
import InboxChat from "@/components/inbox/InboxChat";
import {
  useInboxSocket,
  type InboxChatMode,
  type InboxSeedMessage,
} from "@/hooks/useInboxSocket";

/**
 * Inbox seller (Task 10, spec §5.10) — cùng khuôn hai cột với InboxClient
 * (Task 9): danh sách hội thoại (trái) + khung chat (phải). Khác biệt nằm ở
 * vai trò người xem:
 * - khung chat là `InboxChat variant="seller"`: khối **"Vì sao AI trả lời thế
 *   này?"** LUÔN hiện dưới mỗi tin AI (spec §8.1), ô nhập "Trả lời với tư cách
 *   nhân viên…" (gửi tin ⇒ server tự takeover) và nút **"↩︎ Trả lời cho AI"**
 *   khi hội thoại đang HUMAN;
 * - danh sách hiện tên KHÁCH (không phải tên shop) và link `?conversation={id}`;
 * - badge đêm "🌙 AI đã xử lý {N} hội thoại trong đêm (22h–6h)" — số do server
 *   tính (`countAiConversationsAtNight`, luôn theo giờ VN) rồi truyền xuống.
 *
 * Không tự render bong bóng/chip: mọi thứ trong khung chat vẫn là của InboxChat
 * — hai màn hình dùng chung một nguồn hiển thị, không có bản sao thứ hai.
 *
 * Đổi hội thoại = vòng đời hook mới: `app/seller/inbox/page.tsx` gắn
 * `key={active.id}` quanh component này (cùng hợp đồng với phía khách) nên state
 * socket không bao giờ trộn giữa hai hội thoại.
 */

/** Một dòng danh sách hội thoại — shape server chuẩn bị từ `listShopConversations`. */
export type SellerConversationSummary = {
  id: string;
  buyer: { id: string; name: string };
  mode: InboxChatMode;
  lastMessage: {
    id: string;
    source: InboxSeedMessage["source"];
    content: string;
    createdAt: string;
  } | null;
  /** Mốc hoạt động = max(updatedAt, lastMessage.createdAt) — server đã tính. */
  activityAt: string;
};

/** Hội thoại đang mở kèm lịch sử đã nạp (đủ để hook join + seed state). */
export type SellerActiveConversation = {
  id: string;
  buyerName: string;
  mode: InboxChatMode;
  version: number;
  messages: InboxSeedMessage[];
};

type SellerInboxClientProps = {
  token: string;
  shopName: string;
  /** Số hội thoại có tin AI lúc 22h–6h (giờ VN) — tính ở server, Task 10 dây C. */
  nightCount: number;
  conversations: SellerConversationSummary[];
  active: SellerActiveConversation | null;
};

const timeFormatter = new Intl.DateTimeFormat("vi-VN", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
const dateTimeFormatter = new Intl.DateTimeFormat("vi-VN", {
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** Hôm nay → "HH:mm"; cũ hơn → "dd/MM HH:mm" (cùng định dạng với InboxClient). */
function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  return sameDay ? timeFormatter.format(date) : dateTimeFormatter.format(date);
}

/**
 * Xem trước tin cuối — nhãn theo góc nhìn NGƯỜI BÁN: tin khách là "Khách:", tin
 * mình gửi là "Bạn:"; AI/SYSTEM để nguyên (nội dung tự nói rõ ai đang nói).
 */
function previewText(
  lastMessage: SellerConversationSummary["lastMessage"],
): string {
  if (lastMessage === null) {
    return "Chưa có tin nhắn — khách chưa nhắn gì";
  }
  const flat = lastMessage.content.replace(/\s+/g, " ").trim();
  if (lastMessage.source === "BUYER") {
    return `Khách: ${flat}`;
  }
  if (lastMessage.source === "SELLER") {
    return `Bạn: ${flat}`;
  }
  return flat;
}

export default function SellerInboxClient({
  token,
  shopName,
  nightCount,
  conversations,
  active,
}: SellerInboxClientProps) {
  const {
    messages,
    mode,
    aiThinking,
    error,
    connected,
    sendMessage,
    handBackToAi,
  } = useInboxSocket(token, active);

  const activeId = active?.id ?? null;
  const newest = messages[messages.length - 1] ?? null;

  // Giống InboxClient: hội thoại đang mở lấy tin mới nhất từ socket, giữ ĐÚNG
  // quy tắc hoạt động của server (max(updatedAt, lastMessage.createdAt)) — không
  // sắp lại "thuần tin cuối" vì takeover đổi `updatedAt` mà không tạo tin.
  const items = conversations.map((conversation) => {
    if (conversation.id !== activeId || newest === null) {
      return conversation;
    }
    const lastMessage = {
      id: newest.id,
      source: newest.source,
      content: newest.content,
      createdAt: newest.createdAt,
    };
    return {
      ...conversation,
      mode,
      lastMessage,
      activityAt:
        Date.parse(lastMessage.createdAt) > Date.parse(conversation.activityAt)
          ? lastMessage.createdAt
          : conversation.activityAt,
    };
  });
  items.sort((a, b) => Date.parse(b.activityAt) - Date.parse(a.activityAt));

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 py-5 sm:px-6">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <h1 className="text-lg font-semibold tracking-tight">💬 Inbox khách</h1>
        <span
          title="Số hội thoại có ít nhất một tin AI trả lời trong khung 22h–6h (giờ Việt Nam)"
          className="rounded-full bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300"
        >
          🌙 AI đã xử lý {nightCount} hội thoại trong đêm (22h–6h)
        </span>
      </div>

      <div className="flex min-h-0 flex-col gap-4 lg:flex-row lg:items-stretch">
        <aside className="shrink-0 lg:w-72">
          <div className="flex flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm lg:h-[calc(100svh-10.5rem)] dark:border-zinc-800 dark:bg-zinc-950">
            <h2 className="flex items-center justify-between gap-2 border-b border-zinc-100 px-3.5 py-2.5 text-[11px] font-semibold tracking-wide text-zinc-500 uppercase dark:border-zinc-800 dark:text-zinc-400">
              Hội thoại
              <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium text-zinc-500 normal-case tabular-nums dark:bg-zinc-800 dark:text-zinc-400">
                {items.length}
              </span>
            </h2>

            {items.length === 0 ? (
              <p className="px-3.5 py-6 text-center text-xs text-zinc-400 dark:text-zinc-500">
                Chưa có hội thoại nào — khách nhắn tin từ trang chủ hoặc trong
                live sẽ hiện ở đây.
              </p>
            ) : (
              <ul className="min-h-0 flex-1 space-y-1.5 overflow-y-auto p-2">
                {items.map((item) => {
                  const isActive = item.id === activeId;
                  return (
                    <li key={item.id}>
                      <Link
                        href={`/seller/inbox?conversation=${encodeURIComponent(item.id)}`}
                        aria-current={isActive ? "page" : undefined}
                        className={`block rounded-xl border px-3 py-2 transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 ${
                          isActive
                            ? "border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/50"
                            : "border-zinc-200 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <p className="truncate text-sm font-semibold tracking-tight">
                            🧑 {item.buyer.name}
                          </p>
                          {item.mode === "HUMAN" && (
                            <span
                              title="Bạn đã tiếp quản hội thoại này"
                              className="shrink-0 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-950/60 dark:text-amber-300"
                            >
                              HUMAN
                            </span>
                          )}
                        </div>
                        <p className="mt-0.5 line-clamp-2 text-xs text-zinc-500 dark:text-zinc-400">
                          {previewText(item.lastMessage)}
                        </p>
                        <p className="mt-1 text-[10px] text-zinc-400 tabular-nums dark:text-zinc-500">
                          {formatWhen(item.activityAt)}
                        </p>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </aside>

        <section className="flex h-[62svh] min-h-[420px] min-w-0 flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm lg:h-[calc(100svh-10.5rem)] dark:border-zinc-800 dark:bg-zinc-950">
          {active === null ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-12 text-center">
              <span
                aria-hidden
                className="grid size-14 place-items-center rounded-2xl bg-emerald-50 text-3xl dark:bg-emerald-950/50"
              >
                💬
              </span>
              <h2 className="text-lg font-semibold tracking-tight">
                Chưa có hội thoại để trả lời
              </h2>
              <p className="max-w-sm text-sm text-zinc-500 dark:text-zinc-400">
                Khi khách nhắn tin cho shop (từ trang chủ hoặc nút Tư vấn trong
                live), hội thoại hiện ở cột bên trái. AI trả lời 24/7 — bạn có
                thể tiếp quản bất cứ lúc nào.
              </p>
            </div>
          ) : (
            <InboxChat
              shopName={shopName}
              headerTitle={`🧑 Khách: ${active.buyerName}`}
              messages={messages}
              mode={mode}
              aiThinking={aiThinking}
              connected={connected}
              error={error}
              variant="seller"
              onHandBack={handBackToAi}
              onSend={sendMessage}
            />
          )}
        </section>
      </div>
    </main>
  );
}
