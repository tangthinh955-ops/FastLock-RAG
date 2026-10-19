import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect, unstable_rethrow } from "next/navigation";
import HomeHeader from "@/components/home/HomeHeader";
import InboxClient, {
  type InboxActiveConversation,
  type InboxConversationSummary,
} from "@/components/inbox/InboxClient";
import { COOKIE_NAME } from "@/lib/auth/constants";
import { requireUser } from "@/lib/auth/guards";
import { ApiError } from "@/lib/auth/service";
import type { TokenPayload } from "@/lib/auth/token";
import { toMessageEvent } from "@/lib/chat/flow";
import {
  getMessages,
  getOrCreateConversation,
  listBuyerConversations,
} from "@/lib/chat/service";
import { prisma } from "@/lib/db";

export const metadata: Metadata = { title: "Inbox AI — LiveOrder Demo" };

/**
 * Trang Inbox của khách (Task 9, spec §5.3): đọc cookie phiên + query DB nên
 * luôn render theo từng request.
 *
 * Cùng lý do và cùng cách xử lý với `app/page.tsx` / `/live/[id]`: Next 16 +
 * `cacheComponents` coi `cookies()`/DB ngoài `<Suspense>` là route blocking;
 * `instant = false` là cấu hình docs chỉ định cho segment được phép block (xem
 * `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/02-route-segment-config/instant.md`).
 *
 * Token (cookie) được truyền xuống client như `/live` (spec §4 sanction) để
 * socket `/inbox` handshake JWT; client không tự đọc cookie (httpOnly).
 */
export const instant = false;

type InboxPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function InboxPage({ searchParams }: InboxPageProps) {
  // Proxy đã chặn `/inbox` theo role nhưng đây mới là lớp guard thật: khách
  // chưa đăng nhập → /login; seller vào nhầm → /seller/inbox (trang của Task
  // 10; redirect trước khi trang đó tồn tại vẫn đúng đích đến).
  let user: TokenPayload | null = null;
  try {
    user = await requireUser("BUYER");
  } catch (error) {
    // `requireUser` gọi `cookies()` — lỗi bail-out của Next (không phải 401/403)
    // phải để Next xử lý, không được nuốt rồi redirect sai (docs
    // `unstable_rethrow`).
    unstable_rethrow(error);
    if (error instanceof ApiError && error.status === 403) {
      redirect("/seller/inbox");
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

  // `?shop={id}` (điểm vào từ Tư vấn/Nhắn tin — Task 11): tạo-hoặc-lấy hội thoại
  // rồi mở nó. Chỉ tạo khi shop TỒN TẠI — id lạ trên URL không được làm nổ FK.
  const rawShop = (await searchParams).shop;
  const shopId =
    typeof rawShop === "string" && rawShop !== "" ? rawShop : null;

  if (shopId !== null) {
    const shop = await prisma.shop.findUnique({
      where: { id: shopId },
      select: { id: true },
    });
    if (shop !== null) {
      await getOrCreateConversation(prisma, user.userId, shop.id);
    }
  }

  const conversations = await listBuyerConversations(prisma, user.userId);

  // Hội thoại đang mở: theo `?shop=` nếu hợp lệ, ngược lại mới nhất (danh sách
  // đã sắp đúng quy tắc hoạt động server-side — không sắp lại ở đây).
  const requested =
    shopId === null
      ? null
      : (conversations.find(
          (item) => item.conversation.shopId === shopId,
        ) ?? null);
  const activeItem = requested ?? conversations[0] ?? null;

  const activeMessages =
    activeItem === null
      ? []
      : await getMessages(prisma, activeItem.conversation.id);

  // `shop` optional trong `ConversationListItem` (chỉ để type đủ dùng chung
  // seller); với buyer nó luôn có — thiếu thì bỏ dòng thay vì dựng UI hỏng.
  const summaries: InboxConversationSummary[] = conversations.flatMap(
    (item) => {
      if (item.shop === undefined) {
        return [];
      }
      return [
        {
          id: item.conversation.id,
          shop: { id: item.shop.id, name: item.shop.name },
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
          // Cùng công thức hoạt động với `listBuyerConversations` (Task 6).
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

  const active: InboxActiveConversation | null =
    activeItem === null || activeItem.shop === undefined
      ? null
      : {
          id: activeItem.conversation.id,
          shopName: activeItem.shop.name,
          mode: activeItem.conversation.mode,
          version: activeItem.conversation.version,
          // `toMessageEvent` là phép biến đổi chuẩn của Task 7/8 (bỏ dedupKey,
          // Date → ISO) — trang dùng lại thay vì tự chế shape.
          messages: activeMessages.map(toMessageEvent),
        };

  return (
    <>
      <HomeHeader user={user} />
      <InboxClient
        // Đổi hội thoại = vòng đời client mới: state socket/seed không trộn
        // giữa hai hội thoại (xem docstring useInboxSocket).
        key={active?.id ?? "inbox-empty"}
        token={token}
        conversations={summaries}
        active={active}
      />
    </>
  );
}
