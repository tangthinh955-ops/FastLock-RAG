import { PrismaClient } from "../../generated/prisma/client";
import type { LiveSession, Shop } from "../../generated/prisma/client";
import { ApiError } from "../auth/service";

/**
 * Vòng đời phiên live dạng hàm thuần nhận `prisma` (Task 11): mở phiên, kết
 * thúc phiên + tổng kết, liệt kê phiên đang mở. Route handler `/api/seller/live/*`
 * và `/api/live/active` chỉ là lớp mỏng gọi các hàm này (xem chú thích từng hàm
 * cho quyết định đã chốt), nhờ vậy luật nghiệp vụ test được ở tầng lib mà không
 * cần request scope của Next.
 *
 * Cùng pattern `SeedPrisma`/`AuthPrisma`/`LiveServicePrisma`: caller truyền app
 * singleton (`lib/db.ts`) hoặc `testPrisma` (integration test) — service không
 * tự tạo kết nối.
 */
export type LiveSessionsPrisma = InstanceType<typeof PrismaClient>;

/** Tổng kết một phiên khi kết thúc — Task 13 hiển thị trong popup EndLiveDialog. */
export type LiveSummary = {
  /** Mọi đơn thuộc phiên (kể cả PENDING/CANCELLED) — "chốt được bao nhiêu đơn". */
  orderCount: number;
  /**
   * Tổng `total` các đơn ĐÃ THU TIỀN (`paidAt != null` — gồm PAID lẫn SHIPPED),
   * đúng định nghĩa "doanh thu" thống nhất toàn app (ruling R4, spec §7.10/§12).
   */
  paidRevenue: number;
};

/** Kết quả `endLive` — hợp đồng cố định cho route `/api/seller/live/end`. */
export type EndLiveResult = {
  session: LiveSession;
  summary: LiveSummary;
};

/** Thông báo pin: shop đang có phiên LIVE khác thì không mở thêm (brief Task 11). */
const ERROR_SHOP_ALREADY_LIVE = "Shop đang có live khác";

/** Thông báo pin khi kết thúc phiên không thuộc/không còn LIVE của shop mình. */
const ERROR_NO_SHOP_LIVE = "Không tìm thấy phiên live của shop bạn";

/**
 * Mở phiên live cho shop. Không tự đóng phiên LIVE cũ (dù dữ liệu bất thường
 * có hai phiên) — brief chốt 409 thay vì "dọn hộ": người bán phải biết mình
 * đang lên sóng ở đâu, tự kết thúc rồi mở phiên mới.
 *
 * Giới hạn đã biết: kiểm tra LIVE rồi mới tạo là hai bước rời — hai request
 * start song song (double-click) lọt qua cùng lúc vẫn có thể tạo hai phiên;
 * schema không có ràng buộc unique một phần cho `status = LIVE` nên tầng lib
 * không chặn tuyệt đối được. UI Task 13 disable nút khi đang gọi; chấp nhận
 * cho demo, ghi rõ ở đây để không ai tưởng nhầm là nguyên tử.
 */
export async function startLive(
  prisma: LiveSessionsPrisma,
  shopId: string,
  title: string,
): Promise<LiveSession> {
  const trimmedTitle = title.trim();
  if (trimmedTitle === "") {
    throw new ApiError(400, "Vui lòng nhập tiêu đề live");
  }

  const existing = await prisma.liveSession.findFirst({
    where: { shopId, status: "LIVE" },
    select: { id: true },
  });
  if (existing) {
    throw new ApiError(409, ERROR_SHOP_ALREADY_LIVE);
  }

  return prisma.liveSession.create({
    data: { shopId, title: trimmedTitle, status: "LIVE" },
  });
}

/**
 * Kết thúc phiên theo id: chuyển `ENDED`, ghi `endedAt`, lưu `peakViewers` và
 * trả tổng kết đơn hàng của phiên.
 *
 * `peakViewers` do ROUTE truyền vào (đọc từ `getFakeCommentPeak` — số người xem
 * giả lập chỉ sống trong RAM của gateway, không nằm trong DB); mặc định 0 khi
 * không có giả lập. Service cố ý KHÔNG tự import fake-comments: giữ tầng này
 * thuần DB, test kiểm soát được số peak, và tránh phụ thuộc vòng gateway → service.
 *
 * Mọi thứ nằm trong một transaction: việc chuyển trạng thái dùng `updateMany`
 * có điều kiện `status = LIVE`, nên hai request end song song (double-click)
 * chỉ một request update khớp; request sau chờ khoá hàng rồi thấy `count = 0`
 * và nhận 409 — không có lần ghi thứ hai đè `endedAt`/`peakViewers`.
 */
export async function endLive(
  prisma: LiveSessionsPrisma,
  sessionId: string,
  peakViewers = 0,
): Promise<EndLiveResult> {
  return prisma.$transaction(async (tx) => {
    const session = await tx.liveSession.findUnique({
      where: { id: sessionId },
    });
    if (!session) {
      throw new ApiError(404, "Không tìm thấy phiên live");
    }
    if (session.status !== "LIVE") {
      throw new ApiError(409, "Phiên live đã kết thúc");
    }

    const orderCount = await tx.order.count({
      where: { liveSessionId: sessionId },
    });
    const paid = await tx.order.aggregate({
      where: { liveSessionId: sessionId, paidAt: { not: null } },
      _sum: { total: true },
    });

    // Chốt hạ nguyên tử: chỉ request còn thấy status LIVE mới update được.
    // Request song song đã đọc LIVE từ trước vẫn về count = 0 sau khi chờ lock.
    const { count } = await tx.liveSession.updateMany({
      where: { id: sessionId, status: "LIVE" },
      data: {
        status: "ENDED",
        endedAt: new Date(),
        peakViewers,
      },
    });
    if (count === 0) {
      throw new ApiError(409, "Phiên live đã kết thúc");
    }

    const updated = await tx.liveSession.findUniqueOrThrow({
      where: { id: sessionId },
    });

    return {
      session: updated,
      summary: { orderCount, paidRevenue: paid._sum.total ?? 0 },
    };
  });
}

/**
 * Danh sách phiên đang mở kèm shop — nguồn dữ liệu cho Trang chủ (Task 12) và
 * Studio (Task 13). Sắp mới nhất trước (phiên vừa mở nổi lên đầu danh sách);
 * tách `session`/`shop` phẳng ra để nơi gọi không phải bóc `include` của Prisma.
 */
export async function getActiveLive(
  prisma: LiveSessionsPrisma,
): Promise<Array<{ session: LiveSession; shop: Shop }>> {
  const rows = await prisma.liveSession.findMany({
    where: { status: "LIVE" },
    orderBy: { startedAt: "desc" },
    include: { shop: true },
  });

  return rows.map(({ shop, ...session }) => ({ session, shop }));
}

/**
 * Tra shop của seller đang đăng nhập (`Shop.ownerId` unique). Không có hàng
 * Shop → 403 (không phải 404): tài khoản thiếu quyền bán, không phải tài
 * nguyên không tồn tại — đăng ký mới luôn là BUYER nên chỉ dữ liệu bất thường
 * mới rơi vào nhánh này.
 */
export async function requireSellerShop(
  prisma: LiveSessionsPrisma,
  ownerId: string,
): Promise<Shop> {
  const shop = await prisma.shop.findUnique({ where: { ownerId } });
  if (!shop) {
    throw new ApiError(403, "Tài khoản của bạn chưa có shop");
  }
  return shop;
}

/**
 * Phiên LIVE hiện tại của shop — guard của route `/api/seller/live/end`.
 * Shop chưa mở live (hoặc phiên của shop KHÁC đang LIVE) đều về CÙNG một 404
 * pin "Không tìm thấy phiên live của shop bạn": seller2 không bao giờ kết thúc
 * được phiên của shop 1, và cũng không dò được shop khác có đang live hay không.
 */
export async function requireShopLiveSession(
  prisma: LiveSessionsPrisma,
  shopId: string,
): Promise<LiveSession> {
  const session = await prisma.liveSession.findFirst({
    where: { shopId, status: "LIVE" },
  });
  if (!session) {
    throw new ApiError(404, ERROR_NO_SHOP_LIVE);
  }
  return session;
}
