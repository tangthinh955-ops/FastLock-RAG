import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect, unstable_rethrow } from "next/navigation";
import HomeHeader from "@/components/home/HomeHeader";
import SellerInboxClient, {
  type SellerActiveConversation,
  type SellerConversationSummary,
} from "@/components/inbox/SellerInboxClient";
import { COOKIE_NAME } from "@/lib/auth/constants";
import { requireUser } from "@/lib/auth/guards";
import { ApiError } from "@/lib/auth/service";
import type { TokenPayload } from "@/lib/auth/token";
import { toMessageEvent } from "@/lib/chat/flow";
import { getMessages, listShopConversations } from "@/lib/chat/service";
import { countAiConversationsAtNight } from "@/lib/chat/stats";
import { prisma } from "@/lib/db";

export const metadata: Metadata = { title: "Inbox shop — LiveOrder Demo" };

/**
 * Trang Inbox của seller (Task 10, spec §5.10): đọc cookie phiên + query DB
 * (hội thoại của shop, badge đêm, lịch sử tin) nên luôn render theo từng
 * request.
 *
 * Cùng lý do và cùng cách xử lý với `app/inbox/page.tsx` / studio: Next 16 +
 * `cacheComponents` coi `cookies()`/DB ngoài `<Suspense>` là route blocking;
 * `instant = false` là cấu hình docs chỉ định cho segment được phép block (xem
 * `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/02-route-segment-config/instant.md`).
 *
 * Token (cookie) được truyền xuống client như `/inbox` (spec §4 sanction) để
 * socket `/inbox` handshake JWT; client không tự đọc cookie (httpOnly).
 */
export const instant = false;

type SellerInboxPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function SellerInboxPage({
  searchParams,
}: SellerInboxPageProps) {
  // Proxy đã chặn `/seller/*` theo role nhưng đây mới là lớp guard thật (cùng
  // pattern studio): khách chưa đăng nhập → /login; BUYER vào nhầm → /inbox
  // (inbox của khách) chứ không phải màn hình đăng nhập.
  let user: TokenPayload | null = null;
  try {
    user = await requireUser("SELLER");
  } catch (error) {
    // `requireUser` gọi `cookies()` — lỗi bail-out của Next (không phải 401/403)
    // phải để Next xử lý, không được nuốt rồi redirect sai (docs
    // `unstable_rethrow`).
    unstable_rethrow(error);
    if (error instanceof ApiError && error.status === 403) {
      redirect("/inbox");
    }
    redirect("/login");
  }

  if (user === null) {
    redirect("/login");
  }

  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (token === undefined) {
    redirect("/login");
  }

  // Tra shop theo ownerId như studio. Seller chưa có shop thì không có gì để
  // mở: gateway cũng từ chối handshake socket ("forbidden") nên UI chỉ hiện
  // hướng dẫn thay vì khung chat chết.
  const shop = await prisma.shop.findUnique({
    where: { ownerId: user.userId },
    select: { id: true, name: true },
  });

  if (shop === null) {
    return (
      <>
        <HomeHeader user={user} />
        <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-16">
          <div className="rounded-2xl border border-dashed border-zinc-300 bg-white px-6 py-12 text-center dark:border-zinc-700 dark:bg-zinc-950">
            <p className="text-4xl" aria-hidden>
              🏪
            </p>
            <h1 className="mt-4 text-2xl font-semibold tracking-tight">
              Tài khoản chưa có shop
            </h1>
            <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
              Inbox chỉ dành cho tài khoản seller đã được gắn shop. Hãy dùng tài
              khoản shop demo hoặc liên hệ quản trị viên.
            </p>
          </div>
        </main>
      </>
    );
  }

  // Hai truy vấn độc lập — chạy song song; `countAiConversationsAtNight` là số
  // của cả shop (dây C) nên không phụ thuộc hội thoại đang mở.
  const [conversations, nightCount] = await Promise.all([
    listShopConversations(prisma, shop.id),
    countAiConversationsAtNight(prisma, shop.id),
  ]);

  // `?conversation={id}` (link từ danh sách): chỉ mở hội thoại thuộc shop; id
  // lạ/không thuộc → hội thoại mới nhất, URL cũ vẫn mở được trang bình thường.
  const rawConversation = (await searchParams).conversation;
  const conversationId =
    typeof rawConversation === "string" && rawConversation !== ""
      ? rawConversation
      : null;
  const requested =
    conversationId === null
      ? null
      : (conversations.find(
          (item) => item.conversation.id === conversationId,
        ) ?? null);
  const activeItem = requested ?? conversations[0] ?? null;

  const activeMessages =
    activeItem === null
      ? []
      : await getMessages(prisma, activeItem.conversation.id);

  // `buyer` optional trong `ConversationListItem` (type dùng chung với buyer);
  // listShopConversations luôn kèm buyer — thiếu (user bị xoá) thì coi như mở
  // hội thoại trống thay vì dựng UI hỏng (giống phía khách với `shop`).
  const summaries: SellerConversationSummary[] = conversations.flatMap(
    (item) => {
      if (item.buyer === undefined) {
        return [];
      }
      return [
        {
          id: item.conversation.id,
          buyer: { id: item.buyer.id, name: item.buyer.name },
          mode: item.conversation.mode,
          lastMessage:
            item.lastMessage === null
              ? null
              : {
                  id: item.lastMessage.id,
                  source: item.lastMessage.source,
                  content: item.lastMessage.content,
                  createdAt: item.lastMessage.createdAt.toISOString(),
                },
          // Cùng công thức hoạt động với `listShopConversations` (Task 6).
          activityAt: new Date(
            Math.max(
              item.conversation.updatedAt.getTime(),
              item.lastMessage?.createdAt.getTime() ?? 0,
            ),
          ).toISOString(),
        },
      ];
    },
  );

  const active: SellerActiveConversation | null =
    activeItem === null || activeItem.buyer === undefined
      ? null
      : {
          id: activeItem.conversation.id,
          buyerName: activeItem.buyer.name,
          mode: activeItem.conversation.mode,
          version: activeItem.conversation.version,
          // `toMessageEvent` là phép biến đổi chuẩn của Task 7/8 (bỏ dedupKey,
          // Date → ISO) — trang dùng lại thay vì tự chế shape.
          messages: activeMessages.map(toMessageEvent),
        };

  return (
    <>
      <HomeHeader user={user} />
      <SellerInboxClient
        // Đổi hội thoại = vòng đời client mới: state socket/seed không trộn
        // giữa hai hội thoại (xem docstring useInboxSocket).
        key={active?.id ?? "seller-inbox-empty"}
        token={token}
        shopName={shop.name}
        nightCount={nightCount}
        conversations={summaries}
        active={active}
      />
    </>
  );
}
