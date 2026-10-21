"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { InboxChatMode, InboxMessage } from "@/hooks/useInboxSocket";
import { readTrace, type AiTrace } from "@/lib/chat/trace";

/**
 * Khung chat của Inbox (Task 9 khách + Task 10 seller) — bong bóng theo `source`,
 * chip nguồn + khối chi tiết RAG, banner takeover và ô nhập tin.
 *
 * `variant` (và `orderHref`) là điểm khác biệt giữa hai phía:
 * - `"buyer"` (mặc định, nguyên hành vi Task 9): khối chi tiết kỹ thuật nằm sau
 *   công tắc 🛠 (`tech`), ô nhập "Nhắn tin cho shop…";
 * - `"seller"` (Task 10, spec §8.1/§8.2): khối **"Vì sao AI trả lời thế này?"**
 *   LUÔN hiện dưới mỗi tin AI (không cần công tắc — nên công tắc 🛠 cũng không
 *   render), ô nhập "Trả lời với tư cách nhân viên…" (gửi tin ⇒ server takeover)
 *   và nút **"↩︎ Trả lời cho AI"** khi hội thoại đang HUMAN (`onHandBack`).
 *
 * Bố cục bám mockup screen-03/04 của buổi brainstorm: khối chat là cột phải,
 * bong bóng khách nền emerald bên phải; AI/seller bên trái; tin SYSTEM (nhắc
 * thanh toán của dây A) nổi giữa dạng thanh mảnh.
 *
 * Trace (`trace.error` có thể chứa message thô của lỗi) CHỈ được render khi
 * công tắc 🛠 bật — mặc định UI khách sạch, đúng spec §8.1. Phía seller khối
 * "Vì sao AI…" hiện mặc định là chủ đích (người vận hành cần thấy lý do AI trả
 * lời); đây là chỗ duy nhất trace được render mà không cần công tắc.
 */

/** Gateway chặn ở 2000 ký tự; UI chặn cùng mức để lỗi không đi tới server. */
const MAX_MESSAGE_LENGTH = 2000;

const priceFormatter = new Intl.NumberFormat("vi-VN", {
  maximumFractionDigits: 0,
});
const scoreFormatter = new Intl.NumberFormat("vi-VN", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const msFormatter = new Intl.NumberFormat("vi-VN", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});
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

function formatVnd(value: number): string {
  return `${priceFormatter.format(value)}đ`;
}

/** "1,4" — dấu thập phân kiểu Việt, cùng định dạng với log bắt SKU ngoài live. */
function formatMs(value: number): string {
  return msFormatter.format(value);
}

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

/** Nhãn trạng thái đơn cho chip — cùng bộ chữ với thẻ "Đơn của bạn" (MyOrderCard). */
const ORDER_STATUS_LABELS: Record<string, string> = {
  PENDING: "Chờ thanh toán",
  PAID: "Đã thanh toán",
  SHIPPED: "Đã giao",
  CANCELLED: "Đã huỷ",
};

type SourceChip = { key: string; text: string; title?: string };

/**
 * Chip nguồn dưới tin AI, dựng từ `trace.topK` — đúng "AI trả lời dựa trên gì":
 * - KB truy hồi → `📚 {title}`;
 * - sản phẩm truy hồi → `🛍 {sku} · {name}`; sku/giá tra chéo `trace.products`
 *   (giá/kho đọc lúc dựng prompt — không nằm trong vector);
 * - câu hỏi về đơn (đường template) → chip đơn từ `trace.orderLookup`.
 */
function buildChips(trace: AiTrace): SourceChip[] {
  const chips: SourceChip[] = [];

  for (const entry of trace.topK) {
    if (entry.kind === "kb") {
      chips.push({ key: `kb:${entry.id}`, text: `📚 ${entry.title}` });
      continue;
    }
    const product =
      entry.sku !== undefined
        ? trace.products.find((item) => item.sku === entry.sku)
        : trace.products.find((item) => item.name === entry.title);
    if (product === undefined) {
      chips.push({ key: `sp:${entry.id}`, text: `🛍 ${entry.title}` });
      continue;
    }
    chips.push({
      key: `sp:${entry.id}`,
      text: `🛍 ${product.sku} · ${product.name} — ${formatVnd(product.price)}`,
      title: `Giá/kho đọc lúc AI trả lời: ${formatVnd(product.price)} · còn ${product.stock}`,
    });
  }

  if (trace.orderLookup !== undefined) {
    const { code, status } = trace.orderLookup;
    chips.push({
      key: `order:${code}`,
      text: `🧾 Đơn #${code} · ${ORDER_STATUS_LABELS[status] ?? status}`,
    });
  }

  return chips;
}

/**
 * Khối chi tiết kỹ thuật dưới tin AI: model, topK + điểm, giá/kho lúc trả lời,
 * tokens, ms, fallback/error. `title` đổi theo phía dùng — khách thấy "🛠 Truy
 * vết RAG" (chỉ khi công tắc 🛠 bật), seller thấy "Vì sao AI trả lời thế này?"
 * (luôn hiện, spec §8.1). `trace.error` giữ nguyên văn bản thô của hệ thống.
 */
function TraceBlock({ trace, title }: { trace: AiTrace; title: string }) {
  return (
    <div className="mt-2 rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 py-2 text-[11px] leading-relaxed text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
      <p className="font-semibold text-zinc-700 dark:text-zinc-200">{title}</p>
      <p className="mt-0.5">
        Model: <span className="font-medium">{trace.model}</span> ·{" "}
        {formatMs(trace.elapsedMs)} ms · token {trace.tokens.prompt} vào/
        {trace.tokens.completion} ra
      </p>
      {trace.topK.length > 0 && (
        <ul className="mt-1 space-y-0.5">
          {trace.topK.map((entry) => (
            <li key={entry.id}>
              [{entry.kind === "product" ? "SP" : "KB"}] {entry.title} — điểm{" "}
              {scoreFormatter.format(entry.score)}
            </li>
          ))}
        </ul>
      )}
      {trace.products.length > 0 && (
        <p className="mt-1">
          Giá/kho lúc trả lời:{" "}
          {trace.products
            .map(
              (product) =>
                `${product.sku} ${formatVnd(product.price)} · còn ${product.stock}`,
            )
            .join(" · ")}
        </p>
      )}
      {trace.fallback !== undefined && (
        <p className="mt-1 font-medium text-amber-700 dark:text-amber-400">
          Fallback: {trace.fallback}
        </p>
      )}
      {trace.error !== undefined && (
        <p className="mt-1 break-words text-red-600 dark:text-red-400">
          Lỗi: {trace.error}
        </p>
      )}
    </div>
  );
}

/**
 * Thẻ đơn nhỏ dưới tin có `orderId` (nhắc thanh toán, xác nhận thanh toán).
 * `href` do phía dùng quyết định: khách mở `/orders?order=…`, seller mở
 * `/seller/orders` (trang seller thuộc Task 2 của Plan 3).
 */
function OrderCard({ orderId, href }: { orderId: string; href: string }) {
  return (
    <Link
      href={href}
      // Giữ `orderId` trên DOM để UI/test nhắm đúng thẻ khi một hội thoại có
      // nhiều tin cùng đơn (href do phía dùng tự dựng).
      data-order-id={orderId}
      className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 bg-zinc-50 px-2.5 py-1 text-[11px] font-medium text-zinc-700 transition hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:border-emerald-800 dark:hover:bg-emerald-950/60 dark:hover:text-emerald-300"
    >
      🧾 Xem đơn &amp; QR
    </Link>
  );
}

type MessageRowProps = {
  message: InboxMessage;
  shopName: string;
  /** Khối chi tiết mở bằng công tắc 🛠 (phía khách). */
  tech: boolean;
  /** Khối "Vì sao AI…" luôn hiện, không cần công tắc (phía seller). */
  traceAlways: boolean;
  /** Đích của thẻ đơn dưới tin có `orderId` — khác nhau giữa buyer/seller. */
  orderHref: (orderId: string) => string;
};

/** Một tin trong khung chat — nhánh theo `source`. */
function MessageRow({
  message,
  shopName,
  tech,
  traceAlways,
  orderHref,
}: MessageRowProps) {
  const time = formatWhen(message.createdAt);

  if (message.source === "SYSTEM") {
    return (
      <div className="flex flex-col items-center gap-1">
        <p className="max-w-[92%] rounded-xl border border-amber-200 bg-amber-50 px-3 py-1.5 text-center text-xs leading-relaxed text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
          {message.content}
        </p>
        {message.orderId !== undefined && (
          <OrderCard href={orderHref(message.orderId)} orderId={message.orderId} />
        )}
        {time !== "" && (
          <span className="text-[10px] text-zinc-400 tabular-nums">{time}</span>
        )}
      </div>
    );
  }

  if (message.source === "BUYER") {
    return (
      <div className="flex justify-end">
        <div className="flex max-w-[85%] min-w-0 flex-col items-end sm:max-w-[75%]">
          <div className="rounded-2xl rounded-br-sm bg-emerald-600 px-3.5 py-2.5 text-sm leading-relaxed break-words whitespace-pre-line text-white shadow-sm">
            {message.content}
          </div>
          {message.orderId !== undefined && (
            <div className="mt-1">
              <OrderCard
                href={orderHref(message.orderId)}
                orderId={message.orderId}
              />
            </div>
          )}
          {time !== "" && (
            <span className="mt-0.5 text-[10px] text-zinc-400 tabular-nums">
              {time}
            </span>
          )}
        </div>
      </div>
    );
  }

  // AI và SELLER đều nằm bên trái; AI thêm chip nguồn + khối truy vết.
  const isAi = message.source === "AI";
  const trace = isAi ? readTrace(message.trace) : null;
  const chips = trace === null ? [] : buildChips(trace);

  return (
    <div className="flex justify-start">
      <div className="flex max-w-[85%] min-w-0 flex-col items-start sm:max-w-[75%]">
        <p
          className={`mb-0.5 px-1 text-[11px] font-semibold ${
            isAi
              ? "text-sky-600 dark:text-sky-400"
              : "text-emerald-700 dark:text-emerald-400"
          }`}
        >
          {isAi ? "🤖 AI tư vấn" : `${shopName} · Nhân viên shop`}
        </p>
        <div
          className={`rounded-2xl rounded-bl-sm border px-3.5 py-2.5 text-sm leading-relaxed break-words whitespace-pre-line shadow-sm ${
            isAi
              ? "border-zinc-200 bg-white text-zinc-800 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
              : "border-emerald-200 bg-emerald-50 text-zinc-800 dark:border-emerald-900/70 dark:bg-emerald-950/50 dark:text-zinc-100"
          }`}
        >
          {message.content}
        </div>

        {chips.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {chips.map((chip) => (
              <span
                key={chip.key}
                title={chip.title}
                className="inline-flex max-w-full items-center truncate rounded-full border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-[11px] text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
              >
                {chip.text}
              </span>
            ))}
          </div>
        )}

        {isAi && trace === null && (
          <p className="mt-1 px-1 text-[11px] text-zinc-400 italic dark:text-zinc-500">
            tin cũ — không có truy vết
          </p>
        )}

        {isAi && trace !== null && (tech || traceAlways) && (
          <TraceBlock
            trace={trace}
            title={
              traceAlways ? "Vì sao AI trả lời thế này?" : "🛠 Truy vết RAG"
            }
          />
        )}

        {message.orderId !== undefined && (
          <div className="mt-1">
            <OrderCard
              href={orderHref(message.orderId)}
              orderId={message.orderId}
            />
          </div>
        )}

        {time !== "" && (
          <span className="mt-0.5 px-1 text-[10px] text-zinc-400 tabular-nums">
            {time}
          </span>
        )}
      </div>
    </div>
  );
}

type InboxChatProps = {
  shopName: string;
  messages: InboxMessage[];
  mode: InboxChatMode;
  aiThinking: boolean;
  connected: boolean;
  /** Lỗi `inbox_error` gần nhất — hook tự xoá sau ~4s. */
  error: string | null;
  /** Phía dùng khung chat — quyết định trace/công tắc/nút trả-AI (xem docstring). */
  variant?: "buyer" | "seller";
  /** Công tắc 🛠 "Kỹ thuật" (chỉ phía khách) — state ở InboxClient. */
  tech?: boolean;
  onToggleTech?: () => void;
  /** Seller + mode HUMAN: nút "↩︎ Trả lời cho AI" (emit `hand_back_to_ai`). */
  onHandBack?: () => void;
  /** Tiêu đề khung chat — mặc định "🏪 {shopName}"; seller truyền tên khách. */
  headerTitle?: string;
  /**
   * Đích của thẻ "🧾 Xem đơn & QR" dưới tin có `orderId`. BẮT BUỘC vì InboxChat
   * dùng chung cho buyer + seller: buyer mở `/orders?order=…`, seller mở
   * `/seller/orders` (trang seller thuộc Plan 3 Task 2).
   */
  orderHref: (orderId: string) => string;
  onSend: (content: string) => void;
};

/**
 * Placeholder ô nhập theo vai trò + trạng thái kết nối — tách khỏi JSX cho
 * khỏi chuỗi ternary lồng nhau.
 */
function composerPlaceholder(
  variant: "buyer" | "seller",
  mode: InboxChatMode,
  connected: boolean,
): string {
  if (!connected) {
    return variant === "seller"
      ? "Đang kết nối tới hội thoại…"
      : "Đang kết nối tới shop…";
  }
  if (variant === "seller") {
    return "Trả lời với tư cách nhân viên…";
  }
  return mode === "HUMAN"
    ? "Nhắn cho nhân viên shop…"
    : "Nhắn tin cho shop… (AI sẽ trả lời khi shop chưa vào)";
}

export default function InboxChat({
  shopName,
  messages,
  mode,
  aiThinking,
  connected,
  error,
  variant = "buyer",
  tech = false,
  onToggleTech,
  onHandBack,
  headerTitle,
  orderHref,
  onSend,
}: InboxChatProps) {
  const [text, setText] = useState("");
  const listRef = useRef<HTMLDivElement | null>(null);
  // `length` dừng tăng khi danh sách chạm trần → dùng `seq` làm tín hiệu mới.
  const newestSeq = messages[messages.length - 1]?.seq ?? 0;

  // Cuộn trong đúng khung chat, không dùng scrollIntoView để tránh kéo trang.
  // Deps gồm `aiThinking` để dòng "AI đang trả lời…" hiện ra là thấy ngay.
  useEffect(() => {
    const list = listRef.current;
    if (list !== null) {
      list.scrollTop = list.scrollHeight;
    }
  }, [newestSeq, aiThinking]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = text.trim();
    if (trimmed === "" || !connected) {
      return;
    }
    // Không append lạc quan: gateway phát `message` cho cả người gửi, hook khử
    // trùng theo id nên tin của mình quay về đúng một lần.
    onSend(trimmed);
    setText("");
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-zinc-200 bg-zinc-50 px-3.5 py-2.5 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold tracking-tight">
          {headerTitle ?? `🏪 ${shopName}`}
        </h2>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {!connected && (
            <span className="text-[11px] font-medium text-amber-600 dark:text-amber-400">
              đang kết nối…
            </span>
          )}
          {mode === "HUMAN" ? (
            <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-semibold text-amber-700 dark:bg-amber-950/60 dark:text-amber-300">
              🧑‍💼 Nhân viên shop
            </span>
          ) : (
            <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300">
              🤖 AI tư vấn 24/24
            </span>
          )}
          {variant === "buyer" && (
            <button
              type="button"
              onClick={onToggleTech}
              aria-pressed={tech}
              title='Hiện/ẩn khối "Truy vết RAG" dưới mỗi tin AI'
              className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition ${
                tech
                  ? "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300"
                  : "border-zinc-300 text-zinc-500 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
              }`}
            >
              🛠 Kỹ thuật {tech ? "· bật" : "· tắt"}
            </button>
          )}
        </div>
      </header>

      {mode === "HUMAN" && (
        <div
          role="status"
          className="flex flex-wrap items-center justify-between gap-2 border-b border-amber-200 bg-amber-50 px-3.5 py-2 text-xs font-medium text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200"
        >
          <span>
            {variant === "seller"
              ? "🧑‍💼 Bạn đã tiếp quản hội thoại — AI tạm dừng trả lời khách."
              : "🔔 Nhân viên shop đã tiếp quản — AI tạm dừng trả lời."}
          </span>
          {variant === "seller" && onHandBack !== undefined && (
            <button
              type="button"
              onClick={onHandBack}
              className="shrink-0 rounded-lg border border-amber-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-amber-800 transition hover:bg-amber-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-600 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-200 dark:hover:bg-amber-900/60"
            >
              ↩︎ Trả lời cho AI
            </button>
          )}
        </div>
      )}

      {error !== null && (
        <div
          role="alert"
          className="border-b border-red-200 bg-red-50 px-3.5 py-2 text-xs font-medium text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300"
        >
          ⚠️ {error}
        </div>
      )}

      <div
        ref={listRef}
        aria-live="polite"
        aria-relevant="additions"
        className="flex-1 space-y-3 overflow-y-auto px-3.5 py-4"
      >
        {messages.length === 0 ? (
          <p className="mx-auto w-fit max-w-full rounded-xl bg-zinc-100 px-3 py-2 text-center text-xs text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
            {variant === "seller"
              ? "Chưa có tin nhắn — khách chưa nhắn gì cho shop."
              : "Chưa có tin nhắn — hỏi AI về sản phẩm, size, đổi trả hoặc đơn hàng nhé."}
          </p>
        ) : (
          messages.map((message) => (
            <MessageRow
              key={message.id}
              message={message}
              shopName={shopName}
              tech={tech}
              traceAlways={variant === "seller"}
              orderHref={orderHref}
            />
          ))
        )}

        {aiThinking && (
          <div className="flex justify-start">
            <p className="rounded-2xl rounded-bl-sm border border-zinc-200 bg-white px-3.5 py-2 text-xs text-zinc-500 shadow-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400">
              <span aria-hidden className="animate-pulse">
                🤖
              </span>{" "}
              AI đang trả lời…
            </p>
          </div>
        )}
      </div>

      <form
        onSubmit={handleSubmit}
        className="border-t border-zinc-200 bg-white px-3 py-2.5 dark:border-zinc-800 dark:bg-zinc-950"
      >
        <div className="flex items-center gap-2">
          <label htmlFor="inbox-message-input" className="sr-only">
            {variant === "seller" ? "Trả lời khách" : "Nhắn tin cho shop"}
          </label>
          <input
            id="inbox-message-input"
            type="text"
            value={text}
            onChange={(event) => setText(event.target.value)}
            maxLength={MAX_MESSAGE_LENGTH}
            disabled={!connected}
            placeholder={composerPlaceholder(variant, mode, connected)}
            className="min-w-0 flex-1 rounded-xl border border-zinc-300 bg-white px-3.5 py-2.5 text-sm outline-none transition placeholder:text-zinc-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/30 disabled:cursor-not-allowed disabled:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:focus:border-emerald-500 dark:disabled:bg-zinc-900/60"
          />
          <button
            type="submit"
            disabled={!connected || text.trim() === ""}
            className="shrink-0 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 disabled:cursor-not-allowed disabled:opacity-55"
          >
            Gửi
          </button>
        </div>
        <div className="mt-1 flex items-center justify-between gap-3 px-0.5 text-[11px] text-zinc-400">
          <span>
            {variant === "seller"
              ? mode === "HUMAN"
                ? "Bạn đang trả lời với tư cách nhân viên shop."
                : "Gửi tin sẽ tiếp quản hội thoại — AI tạm dừng trả lời khách."
              : mode === "HUMAN"
                ? "Nhân viên shop đang trả lời bạn."
                : "AI tư vấn 24/7 — shop có thể tiếp quản bất cứ lúc nào."}
          </span>
          <span className="tabular-nums">
            {text.length}/{MAX_MESSAGE_LENGTH}
          </span>
        </div>
      </form>
    </div>
  );
}
