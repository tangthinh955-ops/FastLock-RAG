/**
 * Định dạng dùng chung cho danh sách hội thoại (Inbox khách + Inbox seller).
 *
 * Tách khỏi hai component để không còn hai bản copy lệch nhau: ô thời gian và
 * dòng xem trước tin cuối phải giống nhau ở cả hai màn hình, chỉ khác GÓC NHÌN
 * (buyer/seller) khi gắn nhãn người gửi.
 *
 * File này an toàn cho client bundle: không import Prisma/gateway, chỉ dùng
 * `Intl` — cùng lý do `lib/chat/trace.ts` được tách khỏi `lib/chat/ai.ts`.
 */

/** Nguồn tin trong hội thoại — trùng union của Prisma `MessageSource`. */
export type ChatMessageSource = "BUYER" | "SELLER" | "AI" | "SYSTEM";

/** Phần tối thiểu của một tin cuối cần cho dòng xem trước. */
export type PreviewMessage = {
  source: ChatMessageSource;
  content: string;
};

export type ChatPerspective = "buyer" | "seller";

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

/** Hôm nay → "HH:mm"; cũ hơn → "dd/MM HH:mm" (giờ máy người xem). */
export function formatWhen(iso: string): string {
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
 * Xem trước tin cuối — một dòng phẳng, nhãn người gửi theo góc nhìn người xem:
 * - buyer: tin của mình là "Bạn:", tin shop là "Nhân viên shop:";
 * - seller: tin của khách là "Khách:", tin mình gửi là "Bạn:".
 * AI/SYSTEM để nguyên nội dung (nội dung tự nói rõ ai đang nói).
 */
export function previewText(
  lastMessage: PreviewMessage | null,
  perspective: ChatPerspective,
): string {
  if (lastMessage === null) {
    return perspective === "buyer"
      ? "Chưa có tin nhắn — bắt đầu trò chuyện nhé"
      : "Chưa có tin nhắn — khách chưa nhắn gì";
  }

  const flat = lastMessage.content.replace(/\s+/g, " ").trim();
  if (perspective === "buyer") {
    if (lastMessage.source === "BUYER") {
      return `Bạn: ${flat}`;
    }
    if (lastMessage.source === "SELLER") {
      return `Nhân viên shop: ${flat}`;
    }
    return flat;
  }

  if (lastMessage.source === "BUYER") {
    return `Khách: ${flat}`;
  }
  if (lastMessage.source === "SELLER") {
    return `Bạn: ${flat}`;
  }
  return flat;
}
