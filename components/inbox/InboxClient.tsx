"use client";

import Link from "next/link";
import { useCallback, useSyncExternalStore } from "react";
import InboxChat from "@/components/inbox/InboxChat";
import {
  useInboxSocket,
  type InboxChatMode,
  type InboxSeedMessage,
} from "@/hooks/useInboxSocket";

/**
 * Inbox khách (Task 9, spec §5.3) — layout hai cột: danh sách hội thoại (trái)
 * + khung chat (phải). Component này giữ "state ngoài chat":
 * - socket hook (seed = hội thoại đang mở);
 * - công tắc 🛠 "Kỹ thuật" đọc/ghi `localStorage["inbox.tech"]` qua
 *   `useSyncExternalStore` (không setState trong effect — luật React Compiler;
 *   snapshot server luôn `false` nên hydrate sạch, client re-read ngay sau đó).
 *
 * Đổi hội thoại: các item danh sách là `<Link href="/inbox?shop=…">`; trang
 * server render lại với props mới và đổi `key` của component này (xem
 * `app/inbox/page.tsx`) nên mỗi hội thoại là một vòng đời hook riêng — state
 * socket không bao giờ trộn giữa hai hội thoại.
 */

/** Một dòng danh sách hội thoại — shape server chuẩn bị từ `listBuyerConversations`. */
export type InboxConversationSummary = {
  id: string;
  shop: { id: string; name: string };
  mode: InboxChatMode;
  lastMessage: {
    id: string;
    source: InboxSeedMessage["source"];
    content: string;
    createdAt: string;
  } | null;
  /**
   * Mốc hoạt động = max(updatedAt, lastMessage.createdAt) — server đã tính;
   * client chỉ nâng lên khi có tin mới realtime, không đổi quy tắc.
   */
  activityAt: string;
};

/** Hội thoại đang mở kèm lịch sử đã nạp (đủ để hook join + seed state). */
export type InboxActiveConversation = {
  id: string;
  shopName: string;
  mode: InboxChatMode;
  version: number;
  messages: InboxSeedMessage[];
};

type InboxClientProps = {
  token: string;
  conversations: InboxConversationSummary[];
  active: InboxActiveConversation | null;
};

const TECH_KEY = "inbox.tech";
/** Event nội bộ tab hiện tại — `storage` chỉ bắn giữa các tab. */
const TECH_EVENT = "inbox-tech-change";

function subscribeTech(onStoreChange: () => void): () => void {
  window.addEventListener("storage", onStoreChange);
  window.addEventListener(TECH_EVENT, onStoreChange);
  return () => {
    window.removeEventListener("storage", onStoreChange);
    window.removeEventListener(TECH_EVENT, onStoreChange);
  };
}

function readTechSnapshot(): boolean {
  return window.localStorage.getItem(TECH_KEY) === "1";
}

/** Server không có localStorage — công tắc "tắt" làm snapshot ban đầu. */
function readTechServerSnapshot(): boolean {
  return false;
}

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

/** Hôm nay → "HH:mm"; cũ hơn → "dd/MM HH:mm". */
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

/** Xem trước tin cuối trong danh sách — một dòng phẳng, có nhãn người gửi. */
function previewText(lastMessage: InboxConversationSummary["lastMessage"]): string {
  if (lastMessage === null) {
    return "Chưa có tin nhắn — bắt đầu trò chuyện nhé";
  }
  const flat = lastMessage.content.replace(/\s+/g, " ").trim();
  if (lastMessage.source === "BUYER") {
    return `Bạn: ${flat}`;
  }
  if (lastMessage.source === "SELLER") {
    return `Nhân viên shop: ${flat}`;
  }
  return flat;
}

export default function InboxClient({
  token,
  conversations,
  active,
}: InboxClientProps) {
  const { messages, mode, aiThinking, error, connected, sendMessage } =
    useInboxSocket(token, active);

  const tech = useSyncExternalStore(
    subscribeTech,
    readTechSnapshot,
    readTechServerSnapshot,
  );
  const toggleTech = useCallback(() => {
    const next = !readTechSnapshot();
    window.localStorage.setItem(TECH_KEY, next ? "1" : "0");
    window.dispatchEvent(new Event(TECH_EVENT));
  }, []);

  const activeId = active?.id ?? null;
  const newest = messages[messages.length - 1] ?? null;

  // Hội thoại đang mở lấy tin mới nhất từ socket; giữ ĐÚNG quy tắc hoạt động
  // của server (max(updatedAt, lastMessage.createdAt), mới nhất trước) — không
  // sắp lại "thuần tin cuối" vì takeover đổi `updatedAt` không tạo tin.
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
      <div className="flex min-h-0 flex-col gap-4 lg:flex-row lg:items-stretch">
        <aside className="shrink-0 lg:w-72">
          <div className="flex flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm lg:h-[calc(100svh-8rem)] dark:border-zinc-800 dark:bg-zinc-950">
            <h1 className="flex items-center justify-between gap-2 border-b border-zinc-100 px-3.5 py-2.5 text-[11px] font-semibold tracking-wide text-zinc-500 uppercase dark:border-zinc-800 dark:text-zinc-400">
              Hội thoại
              <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium text-zinc-500 normal-case tabular-nums dark:bg-zinc-800 dark:text-zinc-400">
                {items.length}
              </span>
            </h1>

            {items.length === 0 ? (
              <p className="px-3.5 py-6 text-center text-xs text-zinc-400 dark:text-zinc-500">
                Chưa có hội thoại nào — chọn shop ở trang chủ để bắt đầu.
              </p>
            ) : (
              <ul className="min-h-0 flex-1 space-y-1.5 overflow-y-auto p-2">
                {items.map((item) => {
                  const isActive = item.id === activeId;
                  return (
                    <li key={item.id}>
                      <Link
                        href={`/inbox?shop=${encodeURIComponent(item.shop.id)}`}
                        aria-current={isActive ? "page" : undefined}
                        className={`block rounded-xl border px-3 py-2 transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 ${
                          isActive
                            ? "border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/50"
                            : "border-zinc-200 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <p className="truncate text-sm font-semibold tracking-tight">
                            🏪 {item.shop.name}
                          </p>
                          {item.mode === "HUMAN" && (
                            <span
                              title="Nhân viên shop đã tiếp quản"
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

        <section className="flex h-[62svh] min-h-[420px] min-w-0 flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm lg:h-[calc(100svh-8rem)] dark:border-zinc-800 dark:bg-zinc-950">
          {active === null ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-12 text-center">
              <span
                aria-hidden
                className="grid size-14 place-items-center rounded-2xl bg-emerald-50 text-3xl dark:bg-emerald-950/50"
              >
                💬
              </span>
              <h2 className="text-lg font-semibold tracking-tight">
                Chọn shop để bắt đầu nhắn tin
              </h2>
              <p className="max-w-sm text-sm text-zinc-500 dark:text-zinc-400">
                AI của shop tư vấn 24/7 — hỏi về sản phẩm, size, đổi trả hoặc
                tình trạng đơn hàng.
              </p>
              <Link
                href="/"
                className="mt-1 inline-flex items-center rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
              >
                ← Về trang chủ chọn shop
              </Link>
            </div>
          ) : (
            <InboxChat
              shopName={active.shopName}
              messages={messages}
              mode={mode}
              aiThinking={aiThinking}
              connected={connected}
              error={error}
              tech={tech}
              onToggleTech={toggleTech}
              onSend={sendMessage}
            />
          )}
        </section>
      </div>
    </main>
  );
}
