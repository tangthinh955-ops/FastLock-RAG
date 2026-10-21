import type { PrismaClient } from "../../generated/prisma/client";
import { isNightHour, vietnamHour } from "../chat/stats";
import { readTrace } from "../chat/trace";

/**
 * Số liệu Dashboard `/seller` (Plan 3 Task 5 — spec §5.6).
 *
 * Cùng pattern các service khác: hàm nhận `prisma` (app singleton hoặc
 * `testPrisma`) và `shopId` do caller lấy từ JWT/`requireSellerShop` — không
 * bao giờ nhận `shopId` từ URL/client. `now` là tham số tuỳ chọn để test ghim
 * được thời điểm; production bỏ trống → `new Date()`.
 *
 * Định nghĩa thống nhất toàn app (ruling R-P3-4):
 * - Doanh thu = `sum(total)` của đơn `paidAt != null` với `paidAt` trong
 *   `[start, end)` — gồm PAID + SHIPPED, loại PENDING/CANCELLED.
 * - Đếm đơn và câu hỏi theo `createdAt`; đơn bán/đơn vị theo đơn đã thu tiền.
 * - Mọi biên ngày tính theo lịch Việt Nam (UTC+7, không DST).
 */

export type DashboardRange = "today" | "7d" | "30d";

export type DashboardStats = {
  /** sum(total) của đơn đã thu tiền trong khoảng. */
  revenue: number;
  /** Đếm theo `createdAt` trong khoảng. */
  orderCounts: {
    pending: number;
    paid: number;
    shipped: number;
    cancelled: number;
  };
  /** sum(qty) của đơn đã thu tiền trong khoảng. */
  unitsSold: number;
  /** max(peakViewers) của phiên có `startedAt` trong khoảng; 0 nếu không có. */
  peakViewers: number;
  /** 24 bucket theo giờ VN của `paidAt`. */
  hourlyRevenue: { hour: number; revenue: number }[];
  /** Tối đa 5, qty desc rồi revenue desc. */
  topProducts: { sku: string; name: string; qty: number; revenue: number }[];
  ai: {
    /** Số hội thoại KHÁC NHAU có ≥1 tin AI trong khoảng. */
    conversations: number;
    /** Như trên nhưng tin AI rơi vào khung đêm [22h, 6h) giờ VN. */
    nightConversations: number;
    /** Trung bình `trace.elapsedMs` của tin AI đọc trace được; null nếu không có. */
    avgResponseMs: number | null;
    /** Tối đa 5 câu hỏi BUYER, đã chuẩn hoá nội dung. */
    topQuestions: { text: string; count: number }[];
  };
};

const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** 00:00 giờ VN của ngày chứa `at`, trả về dạng instant UTC. */
function vnDayStart(at: Date): Date {
  const shifted = at.getTime() + VN_OFFSET_MS;
  return new Date(Math.floor(shifted / DAY_MS) * DAY_MS - VN_OFFSET_MS);
}

/** `?range=` lạ (kể cả thiếu) mặc định 7 ngày — có số seed ngay khi mở. */
function normalizeRange(range: DashboardRange): DashboardRange {
  if (range === "today" || range === "30d") {
    return range;
  }
  return "7d";
}

/**
 * Biên khoảng theo lịch VN (UTC+7, không DST); 7d/30d tính cả hôm nay:
 * `7d` = todayStart - 6 ngày, `30d` = todayStart - 29 ngày, `end` = now.
 */
export function rangeBounds(
  range: DashboardRange,
  now: Date = new Date(),
): { start: Date; end: Date } {
  const todayStart = vnDayStart(now);
  const normalized = normalizeRange(range);

  const start =
    normalized === "today"
      ? todayStart
      : normalized === "30d"
        ? new Date(todayStart.getTime() - 29 * DAY_MS)
        : new Date(todayStart.getTime() - 6 * DAY_MS);

  return { start, end: now };
}

/** Chuẩn hoá câu hỏi: trim + gộp khoảng trắng + lowercase để gom biến thể. */
function normalizeQuestion(content: string): string {
  return content.trim().replace(/\s+/g, " ").toLowerCase();
}

export async function getDashboardStats(
  prisma: PrismaClient,
  shopId: string,
  range: DashboardRange,
  now: Date = new Date(),
): Promise<DashboardStats> {
  const { start, end } = rangeBounds(range, now);
  // Cùng một khoảng đóng đầu mở cuối cho mọi phép lọc.
  const withinRange = { gte: start, lt: end };

  const [orders, sessions, messages] = await Promise.all([
    prisma.order.findMany({
      where: {
        shopId,
        // Đơn tạo trong khoảng (đếm trạng thái) HOẶC thu tiền trong khoảng
        // (doanh thu) — lượt lọc chính xác làm lại bằng JS bên dưới.
        OR: [{ createdAt: withinRange }, { paidAt: withinRange }],
      },
      select: {
        status: true,
        total: true,
        qty: true,
        createdAt: true,
        paidAt: true,
        product: { select: { sku: true, name: true } },
      },
    }),
    prisma.liveSession.findMany({
      where: { shopId, startedAt: withinRange },
      select: { peakViewers: true },
    }),
    prisma.directMessage.findMany({
      where: { conversation: { shopId }, createdAt: withinRange },
      select: {
        conversationId: true,
        source: true,
        content: true,
        createdAt: true,
        trace: true,
      },
      // Thứ tự tăng dần để "text gốc mới nhất" của mỗi câu hỏi là bản cuối.
      orderBy: { createdAt: "asc" },
    }),
  ]);

  const orderCounts = {
    pending: 0,
    paid: 0,
    shipped: 0,
    cancelled: 0,
  };
  const hourlyRevenue = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    revenue: 0,
  }));
  const productTotals = new Map<
    string,
    { sku: string; name: string; qty: number; revenue: number }
  >();

  let revenue = 0;
  let unitsSold = 0;

  for (const order of orders) {
    if (
      order.createdAt.getTime() >= start.getTime() &&
      order.createdAt.getTime() < end.getTime()
    ) {
      switch (order.status) {
        case "PENDING":
          orderCounts.pending += 1;
          break;
        case "PAID":
          orderCounts.paid += 1;
          break;
        case "SHIPPED":
          orderCounts.shipped += 1;
          break;
        case "CANCELLED":
          orderCounts.cancelled += 1;
          break;
      }
    }

    const paidAt = order.paidAt;
    if (
      paidAt === null ||
      paidAt.getTime() < start.getTime() ||
      paidAt.getTime() >= end.getTime()
    ) {
      continue;
    }

    revenue += order.total;
    unitsSold += order.qty;
    hourlyRevenue[vietnamHour(paidAt)].revenue += order.total;

    const product = productTotals.get(order.product.sku);
    if (product) {
      product.qty += order.qty;
      product.revenue += order.total;
    } else {
      productTotals.set(order.product.sku, {
        sku: order.product.sku,
        name: order.product.name,
        qty: order.qty,
        revenue: order.total,
      });
    }
  }

  const topProducts = [...productTotals.values()]
    .sort(
      (a, b) =>
        b.qty - a.qty ||
        b.revenue - a.revenue ||
        a.sku.localeCompare(b.sku),
    )
    .slice(0, 5);

  const peakViewers = sessions.reduce(
    (max, session) => Math.max(max, session.peakViewers),
    0,
  );

  const aiConversations = new Set<string>();
  const nightConversations = new Set<string>();
  const elapsedValues: number[] = [];
  const questionCounts = new Map<string, { text: string; count: number }>();

  for (const message of messages) {
    if (message.source === "AI") {
      aiConversations.add(message.conversationId);
      if (isNightHour(vietnamHour(message.createdAt))) {
        nightConversations.add(message.conversationId);
      }

      // Tin AI cũ/thiếu trace không được kéo lệch hay làm hỏng phép chia.
      const trace = readTrace(message.trace);
      if (trace !== null) {
        elapsedValues.push(trace.elapsedMs);
      }
      continue;
    }

    if (message.source !== "BUYER") {
      continue;
    }

    const key = normalizeQuestion(message.content);
    if (key === "") {
      continue;
    }

    const existing = questionCounts.get(key);
    if (existing) {
      existing.count += 1;
      // Hiển thị nội dung gốc của tin MỚI NHẤT (messages đang xếp tăng dần).
      existing.text = message.content;
    } else {
      questionCounts.set(key, { text: message.content, count: 1 });
    }
  }

  const topQuestions = [...questionCounts.values()]
    .sort(
      (a, b) => b.count - a.count || a.text.localeCompare(b.text, "vi"),
    )
    .slice(0, 5);

  const avgResponseMs =
    elapsedValues.length === 0
      ? null
      : elapsedValues.reduce((sum, value) => sum + value, 0) /
        elapsedValues.length;

  return {
    revenue,
    orderCounts,
    unitsSold,
    peakViewers,
    hourlyRevenue,
    topProducts,
    ai: {
      conversations: aiConversations.size,
      nightConversations: nightConversations.size,
      avgResponseMs,
      topQuestions,
    },
  };
}
