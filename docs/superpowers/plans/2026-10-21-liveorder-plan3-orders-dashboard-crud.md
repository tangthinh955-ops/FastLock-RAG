# LiveOrder Plan 3 — Đơn hàng/QR, quản trị shop, Dashboard & đóng gói demo (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hoàn tất M4 + M5 của spec: khách xem/thanh toán đơn giả lập qua QR, seller CRUD sản phẩm + KB (RAG đổi ngay), seller quản lý đơn (giao/hủy hoàn kho), Dashboard đọc số thật từ DB (doanh thu, biểu đồ giờ, top SP, Hiệu quả AI), popup kết thúc live dẫn sang Dashboard, và đóng gói demo (README + kịch bản + kiểm thử toàn bộ §10/§12). Kèm dọn các minor đã hoãn từ Plan 1/2.

**Architecture:** Không đổi schema Prisma. Thêm tầng service thuần nhận `prisma` (giống `lib/live/sessions.ts`, `lib/chat/service.ts`) cho đơn hàng/sản phẩm/KB/dashboard; route handler chỉ là lớp mỏng `requireUser` + validate + gọi service; trang seller/buyer là server component đọc DB, phần tương tác là client component gọi REST rồi `router.refresh()`. QR sinh local bằng `qrcode` từ chuỗi demo chứa `paymentCode` (không gọi mạng, không tài khoản thật). Mọi thay đổi KB/sản phẩm gọi `invalidateShopIndex(shopId)` để câu trả lời AI phản ánh ngay. Thanh toán PAID chỉ qua một đường duy nhất `POST /api/orders/[id]/pay` khi `DEMO_MODE=true`, tạo tin SYSTEM `order:{id}:paid` + phát socket `/inbox`.

**Tech stack:** Next.js 16 (App Router, `instant = false` cho trang đọc cookie/DB), React 19, Prisma 7 + PostgreSQL, socket.io (custom `server.ts`), Tailwind v4, Vitest, `qrcode` (dependency mới duy nhất — spec §4 cho phép).

**Spec:** `docs/superpowers/specs/2026-10-16-liveorder-nextjs-demo-design.md` — thực thi §5.4, §5.6–5.9, §5.5 (nút Dashboard), §8.6, §8.7, §9 (trace seed), §10, §12. Plan 1/2 là tiền đề đã merge vào `master`.

**Trạng thái xuất phát:** `master` @ `48fe7fe`, Plan 1 + Plan 2 xong; 21 file test xanh (186 passed + 1 skipped). DB demo đang giữ dữ liệu smoke — `npm run seed` phục hồi nền sạch.

---

## Quyết định đã chốt — KHÔNG mở lại khi thực thi

1. **Doanh thu = tổng `total` của đơn có `paidAt != null`** (gồm PAID **và** SHIPPED vì SHIPPED đã thu tiền), loại PENDING/CANCELLED. Đây là ruling Plan 1 (Global Constraints) đã thống nhất cho popup tổng kết lẫn Dashboard; spec §5.6 ghi "chỉ đơn PAID" là cách nói tắt, §7.10/§12 nhất quán với `paidAt`.
2. **Mốc thời gian Dashboard:** doanh thu/biểu đồ/top SP/SP đã bán tính theo `paidAt`; số đơn theo trạng thái tính theo `createdAt`; đỉnh người xem lấy `max(peakViewers)` của các phiên có `startedAt` trong khoảng. "Hôm nay" = từ 00:00 giờ VN; "7 ngày"/"30 ngày" = 7/30 ngày lịch gần nhất **tính cả hôm nay**. Mặc định mở Dashboard là **7 ngày** để có số liệu seed ngay (spec B5), người xem vẫn bấm được Hôm nay/30 ngày.
3. **PAID chỉ có một đường:** `POST /api/orders/[id]/pay` (BUYER, `DEMO_MODE=true`). Không route/UI nào khác đổi trạng thái sang PAID. Seed lịch sử được phép có PAID (dữ liệu hợp lệ).
4. **Hủy đơn:** chỉ PENDING → CANCELLED + cộng lại kho **trong cùng transaction**. PAID/SHIPPED trả 409, không hoàn tiền (ngoài phạm vi demo).
5. **Giao đơn:** chỉ PAID → SHIPPED. Không có bước "xác nhận" riêng.
6. **QR demo:** sinh offline bằng `qrcode`; nội dung là chuỗi nhiều dòng có tiền tố `LIVEORDER-DEMO` + `CODE:<paymentCode>` + `ORDER:#<code>` + `AMOUNT:<total>` + thông tin ngân hàng demo từ env (`DEMO_BANK_ID`, `DEMO_BANK_ACCOUNT`, `DEMO_BANK_OWNER`, có default). Không dùng VietQR thật, không gọi API ngoài.
7. **Cross-shop:** mọi service seller nhận `shopId` lấy từ JWT qua `requireSellerShop`; tài nguyên của shop khác trả **cùng một 404** ("Không tìm thấy … của shop bạn") để không dò được sự tồn tại.
8. **RAG freshness:** mọi create/update/delete KB hoặc sản phẩm gọi `invalidateShopIndex(shopId)` **sau khi** DB ghi thành công. Giá/kho vốn đọc live lúc dựng prompt; invalidate để tên/SKU mới vào index.
9. **Không thêm thư viện chart** — biểu đồ là SVG/CSS thuần.
10. **Minor hoãn có chủ đích (ghi nhận, không làm trong Plan 3):** backfill tin nhắn sau reconnect (cần REST mới — rủi ro thấp, chỉ ảnh hưởng tin đến đúng lúc mất mạng), giới hạn RAM index RAG, nén ảnh upload. Ghi vào README mục "Giới hạn đã biết".

---

## Global Constraints (áp cho MỌI task)

- UI **tiếng Việt**; tiền là **số nguyên VND** (`Int`), format bằng `Intl.NumberFormat("vi-VN")`.
- **Danh tính HTTP luôn từ JWT** (`requireUser`), tuyệt đối không tin `shopId`/`buyerId`/`role` trong body/URL. `shopId` của seller luôn suy ra từ `Shop.ownerId = user.userId`.
- Không đổi `prisma/schema.prisma` (mọi field cần dùng đã có). Không thêm migration.
- Route handler: bắt `unstable_rethrow(error)` trước, rồi `ApiError` → JSON `{ error }` đúng status, còn lại 500 + `console.error`. Body JSON hỏng → 400, không để nổ 500.
- Next 16: route động nhận `params` là **Promise** (`const { id } = await params`); trang đọc `searchParams` cũng là Promise.
- Trang đọc cookie/DB: `export const instant = false` và guard thật trong trang (proxy chỉ là lớp lạc quan) — copy khuôn `app/seller/studio/page.tsx`.
- Mọi trang mới dùng `HomeHeader user={user}`; seller nav do Task 6 thêm vào `HomeHeader`.
- Test **offline**: không gọi Groq/mạng; RAG test dùng fake embedder (khuôn `tests/rag-index.test.ts`), DB dùng `resetDb()` + `testPrisma` từ `tests/helpers/db.ts`.
- Chạy `npx vitest run tests/<file>` khi làm từng task; cuối mỗi task `npm run lint` + `npx tsc --noEmit` (nếu máy mới: `npx next typegen` trước).
- Commit message tiếng Việt, mỗi task một commit. Báo cáo bằng chứng vào `.superpowers/sdd/<workspace>/task-N-report.md` khi thực thi theo SDD.
- Không sửa `.env` thật ngoài việc **thêm** 3 biến ngân hàng demo; không đụng `GROQ_API_KEY`.

---

## Phạm vi HOÃN — KHÔNG làm trong Plan 3

- Webhook thanh toán thật/hoàn tiền (spec §8.6 chỉ giả lập).
- Upload ảnh lên cloud, resize/nén ảnh, nhiều ảnh/SP.
- Backfill tin nhắn sau reconnect; hàng đợi AI khi mất mạng.
- Responsive mobile hoàn hảo (spec §5 ưu tiên desktop).
- Refund/partial cancel; sửa đơn sau khi tạo.
- Bảng phụ trợ Dashboard (spec §6: suy trực tiếp từ `DirectMessage`).

---

## Review Focus (5 nhóm lỗi dễ “cắn” nhất)

1. **Thanh toán một đường + chống trùng:** bấm 2 lần/2 tab → đúng 1 lần PENDING→PAID, đúng 1 tin SYSTEM `order:{id}:paid`; không có route nào khác ghi PAID.
2. **Hoàn kho nguyên tử:** hủy 2 lần liên tiếp → kho chỉ cộng 1 lần; hủy đơn PAID/SHIPPED bị chặn; giao đơn PENDING bị chặn.
3. **Cách ly 2 shop:** seller shop B không đọc/sửa/xóa được sản phẩm, KB, đơn của shop A (cùng 404); dashboard shop B chỉ thấy số của shop B.
4. **RAG đổi ngay:** sửa tiêu đề/nội dung KB (và tên sản phẩm) → lần `retrieve` kế tiếp thấy nội dung mới, không còn entry cũ.
5. **Số liệu Dashboard đúng định nghĩa:** doanh thu chỉ `paidAt != null` (gồm SHIPPED), lọc Hôm nay/7/30 cho số khác nhau, top SP/đỉnh người xem/AI đều đọc DB (không hard-code).

---

## Task 1: Nền đơn hàng phía khách — `/orders`, QR, giả lập thanh toán

**Mục tiêu:** Khách xem danh sách đơn + chi tiết + QR của đơn PENDING; bấm "Giả lập đã chuyển khoản" → PAID + tin SYSTEM vào Inbox; các điểm vào `/orders` từ live/Inbox/header hoạt động.

**Files:**
- `package.json` — thêm `qrcode` (dependencies), `@types/qrcode` (devDependencies).
- `.env.example` + `.env` — thêm 3 biến demo bank (mục dưới).
- `lib/orders/service.ts` (mới)
- `lib/orders/qr.ts` (mới)
- `lib/chat/notify.ts` (mới) + sửa `lib/chat/reminders.ts` dùng lại helper
- `app/api/orders/[id]/pay/route.ts` (mới)
- `app/orders/page.tsx` (mới), `components/orders/PayButton.tsx` (mới)
- `components/inbox/InboxChat.tsx`, `components/live/MyOrderCard.tsx`, `components/home/HomeHeader.tsx`
- `tests/orders-service.test.ts` (mới)

**Interfaces (chốt trước khi code):**

```ts
// lib/orders/service.ts
import { Prisma } from "../../generated/prisma/client";
import type {
  DirectMessage,
  PrismaClient,
} from "../../generated/prisma/client";

export type OrdersPrisma = PrismaClient;
export type OrderWithRefs = Prisma.OrderGetPayload<{
  include: { product: true; shop: true };
}>;

/** Đơn của đúng buyer, mới nhất trước (code desc — code autoincrement). */
export async function listBuyerOrders(
  prisma: OrdersPrisma,
  buyerId: string,
): Promise<OrderWithRefs[]>;

/** null khi đơn không tồn tại HOẶC không thuộc buyer (một câu trả lời, không lộ). */
export async function getBuyerOrder(
  prisma: OrdersPrisma,
  buyerId: string,
  orderId: string,
): Promise<OrderWithRefs | null>;

/**
 * Đường DUY NHẤT để PAID. Transaction: updateMany WHERE id+buyerId+status=PENDING.
 * count 0 → ApiError(409, "Đơn không còn ở trạng thái chờ thanh toán").
 * Sau commit: getOrCreateConversation + appendMessage SYSTEM
 *   dedupKey `order:{id}:paid`, orderId, nội dung "✅ Đã nhận thanh toán đơn #<code> — <tên SP> ×<qty> — <total>đ. Shop sẽ chuẩn bị hàng ngay!"
 * message = null nếu dedupKey đã tồn tại (gọi lại không tạo tin thứ hai).
 */
export async function markOrderPaid(
  prisma: OrdersPrisma,
  input: { orderId: string; buyerId: string },
): Promise<{ order: OrderWithRefs; message: DirectMessage | null }>;
```

```ts
// lib/orders/qr.ts
export type DemoBankInfo = { bankId: string; account: string; owner: string };
export function demoBankInfo(): DemoBankInfo; // env ?? default 970436 / 0000000000 / LIVEORDER DEMO
export function paymentQrContent(order: {
  paymentCode: string;
  code: number;
  total: number;
}): string; // nhiều dòng: LIVEORDER-DEMO / BANK / ACCOUNT / OWNER / CODE / ORDER / AMOUNT
export function renderQrDataUrl(content: string): Promise<string>; // qrcode.toDataURL({ width: 240, margin: 1 })
```

```ts
// lib/chat/notify.ts
import type { InboxMessageEvent } from "./gateway";
/** Phát tin vào phòng conversation + shop của namespace /inbox (no-op nếu chưa có io). */
export function emitInboxMessage(
  event: InboxMessageEvent["message"],
  conversationId: string,
  shopId: string,
): void;
```

**Steps:**

- [ ] **1.1 Cài dependency + env.**
  ```bash
  npm install qrcode
  npm install -D @types/qrcode
  ```
  Thêm vào `.env.example` (và `.env` nếu muốn đổi):
  ```dotenv
  # Ngân hàng DEMO cho QR (không phải tài khoản thật)
  DEMO_BANK_ID=970436
  DEMO_BANK_ACCOUNT=0000000000
  DEMO_BANK_OWNER=LIVEORDER DEMO
  ```
  Không cần migration/`prisma generate` (schema không đổi).

- [ ] **1.2 Test trước — `tests/orders-service.test.ts`.** Fixture tối thiểu bằng `testPrisma` (buyer, seller+shop, product, order PENDING). Các case:
  - `markOrderPaid`: status → PAID, `paidAt` khác null; đúng 1 `DirectMessage` source SYSTEM, `dedupKey = order:{id}:paid`, `orderId` set, nội dung chứa `#<code>` và số tiền; conversation buyer↔shop được tạo.
  - Gọi lần 2 → `ApiError` status 409, vẫn chỉ 1 tin SYSTEM, `paidAt` không đổi.
  - Buyer khác gọi → 409, đơn vẫn PENDING, không có tin SYSTEM.
  - `listBuyerOrders` chỉ trả đơn của buyer, sort `code desc`, include `product`/`shop`.
  - `getBuyerOrder` trả null với buyer sai.
  - QR: `paymentQrContent` chứa `paymentCode`, `#code`, `total`; `renderQrDataUrl` trả chuỗi bắt đầu `data:image/png;base64,`.
  Chạy `npx vitest run tests/orders-service.test.ts` → đỏ (module chưa có).

- [ ] **1.3 Viết `lib/orders/service.ts`.** Dùng `prisma.$transaction` cho bước đổi trạng thái; lấy lại order kèm `product`/`shop` sau update. Ngoài transaction: `getOrCreateConversation(prisma, buyerId, order.shopId)` rồi `appendMessage(..., { source: "SYSTEM", dedupKey: \`order:${id}:paid\`, orderId, content })`. KHÔNG phát socket trong service (route phát) — giữ service test được offline. Bọc riêng phần tạo tin SYSTEM trong `try/catch`: PAID đã commit thì lỗi ghi tin không được biến route thành 500 (log lỗi, trả order; tin có thể thiếu trong tình huống DB lỗi hiếm).

- [ ] **1.4 Viết `lib/orders/qr.ts`** + test đã có. `qrcode` chỉ import ở module server này (trang server component dùng), không import vào client component.

- [ ] **1.5 Tách `lib/chat/notify.ts` và refactor `lib/chat/reminders.ts`.** Chuyển nguyên thân `registryEmit` sang `emitInboxMessage`; `reminders.ts` gọi helper, giữ nguyên `deps.emit` override cho test. Chạy lại `npx vitest run tests/chat-reminders.test.ts` để chắc không đổi hành vi.

- [ ] **1.6 Route `app/api/orders/[id]/pay/route.ts`.**
  - `const user = await requireUser("BUYER")` trước; sau đó `DEMO_MODE !== "true"` → 403 `"Tính năng giả lập thanh toán chỉ bật ở chế độ demo"` (không tiết lộ trạng thái demo cho người chưa đăng nhập).
  - `const { id } = await params` (Next 16: `params` là Promise).
  - Gọi `markOrderPaid`; nếu `message !== null` → `emitInboxMessage(toMessageEvent(message), message.conversationId, order.shopId)`.
  - Trả `{ order }` (không trả message thô).
  - Bắt lỗi theo Global Constraints (`unstable_rethrow` trước).

- [ ] **1.7 Trang `/orders` + `PayButton`.**
  - `app/orders/page.tsx`: `instant = false`; guard BUYER theo khuôn `/inbox` (401 → `/login`; 403 vì là seller → `/seller/inbox`); `searchParams` là Promise, đọc `?order=<id>`.
  - `listBuyerOrders`; chọn đơn theo `?order` nếu thuộc buyer, ngược lại đơn đầu tiên.
  - Layout 2 cột (desktop): danh sách đơn bên trái (mỗi dòng `Link href={"/orders?order=" + order.id}`, badge trạng thái, `#code`, SP ×qty, tổng tiền); chi tiết bên phải.
  - Chi tiết: thông tin shop/SP/số tiền/ngày tạo; nếu PENDING → QR (`renderQrDataUrl(paymentQrContent(order))`) + thông tin ngân hàng demo + `<PayButton orderId={order.id} />` + ghi chú "Chỉ là giao dịch giả lập, không chuyển tiền thật"; nếu PAID/SHIPPED/CANCELLED → banner trạng thái, không hiện nút.
  - Empty state: "Bạn chưa có đơn nào — vào live và gõ mã sản phẩm (vd. SP01 2 cái) để chốt đơn."
  - `components/orders/PayButton.tsx` ("use client"): `fetch("/api/orders/" + orderId + "/pay", { method: "POST" })`; pending → "Đang xử lý…"; lỗi → hiện `error`; thành công → `router.refresh()`.
  - Không cần token/socket ở trang này.

- [ ] **1.8 Nối điểm vào `/orders`.**
  - `components/home/HomeHeader.tsx`: với BUYER thêm `Link` "🧾 Đơn của tôi" cạnh "💬 Inbox".
  - `components/live/MyOrderCard.tsx`: bỏ nút disabled + nhãn "Plan 3"; mỗi dòng đơn bọc `Link href={"/orders?order=" + order.id}` (giữ layout), footer "Xem đơn & QR →" là `Link` tới `/orders` (hoặc đơn mới nhất).
  - `components/inbox/InboxChat.tsx`: thêm prop **`orderHref: (orderId: string) => string`** (InboxChat dùng chung cho buyer + seller). `OrderCard` nhận `{ orderId, href }`, render `Link href={href}` nhãn "🧾 Xem đơn & QR"; cập nhật cả 3 call site.
    - `InboxClient` truyền `orderHref={(id) => \`/orders?order=${id}\`}`.
    - `SellerInboxClient` truyền `orderHref={() => "/seller/orders"}` (seller không vào trang buyer; trang seller thuộc Task 2).

- [ ] **1.9 Kiểm tra + commit.**
  ```bash
  npx vitest run tests/orders-service.test.ts tests/chat-reminders.test.ts
  npm run lint
  npx tsc --noEmit
  ```
  Commit: `feat: /orders + QR + thanh toán giả lập (Plan 3 T1)`

---

## Task 2: Seller quản lý đơn — giao (PAID→SHIPPED) và hủy (PENDING→CANCELLED, hoàn kho)

**Mục tiêu:** `/seller/orders` liệt kê đơn của đúng shop; giao đơn đã thanh toán; hủy đơn chờ thanh toán và hoàn kho nguyên tử; mọi thao tác chéo shop bị chặn.

**Files:**
- `lib/orders/service.ts` (bổ sung)
- `app/api/seller/orders/[id]/ship/route.ts`, `app/api/seller/orders/[id]/cancel/route.ts` (mới)
- `app/seller/orders/page.tsx` (mới), `components/orders/SellerOrdersClient.tsx` (mới)
- `tests/orders-seller.test.ts` (mới)

**Interfaces (bổ sung vào `lib/orders/service.ts`):**

```ts
// (cùng file; đã có `import { Prisma }` từ Task 1)
export type ShopOrderRow = Prisma.OrderGetPayload<{
  include: { product: true; buyer: { select: { name: true } } };
}>;

export async function listShopOrders(
  prisma: OrdersPrisma,
  shopId: string,
): Promise<ShopOrderRow[]>; // code desc

/** PAID → SHIPPED. Không thấy (id+shopId) → 404; sai trạng thái → 409. */
export async function shipOrder(
  prisma: OrdersPrisma,
  input: { shopId: string; orderId: string },
): Promise<ShopOrderRow>;

/**
 * PENDING → CANCELLED + stock += qty trong CÙNG transaction.
 * Không thấy → 404; không phải PENDING → 409 "Chỉ hủy được đơn đang chờ thanh toán".
 * Đua 2 lần hủy: updateMany WHERE status=PENDING, count 0 → throw → rollback (kho chỉ cộng 1 lần).
 */
export async function cancelOrder(
  prisma: OrdersPrisma,
  input: { shopId: string; orderId: string },
): Promise<ShopOrderRow>;
```

**Steps:**

- [ ] **2.1 Test trước — `tests/orders-seller.test.ts`.**
  - `cancelOrder` PENDING: status CANCELLED, stock +qty đúng 1 lần; gọi lần 2 → 409 và stock không đổi.
  - `cancelOrder` PAID/SHIPPED → 409, không đổi kho/trạng thái.
  - `shipOrder` PAID → SHIPPED; PENDING → 409; gọi lần 2 → 409.
  - shop B gọi hủy/giao đơn shop A → 404 (`ApiError`), đơn shop A không đổi.
  - `listShopOrders` chỉ đơn của shop, include `buyer.name` + `product`.
  - Đua hủy: `Promise.allSettled([cancel, cancel])` → đúng 1 fulfilled, stock chỉ +qty 1 lần (dùng 2 transaction thật trên testPrisma).

- [ ] **2.2 Viết service.** `shipOrder`/`cancelOrder` dùng `findFirst({ id, shopId })` **bên trong `$transaction`** trước để phân biệt 404/409, sau đó `updateMany` có điều kiện trạng thái để chống đua; nhánh cancel cộng kho bằng `tx.product.update({ where: { id: order.productId }, data: { stock: { increment: order.qty } } })` trong cùng transaction.

- [ ] **2.3 Hai route seller.** `requireUser("SELLER")` → `requireSellerShop(prisma, user.userId)` → gọi service → trả `{ order }`. Không nhận `shopId` từ client.

- [ ] **2.4 Trang `/seller/orders` + client.**
  - Guard seller theo khuôn studio; shop null → empty state (dùng lại copy của studio).
  - Bảng/card: `#code`, khách, SP ×qty, tổng, trạng thái, ngày tạo, nút hành động:
    - PENDING → "Hủy đơn" (đỏ, có confirm `window.confirm("Hủy đơn #...? Kho sẽ được hoàn lại.")`).
    - PAID → "Giao hàng".
    - SHIPPED/CANCELLED → không nút.
  - `components/orders/SellerOrdersClient.tsx`: state pending theo orderId, gọi `POST /api/seller/orders/<id>/ship|cancel`, lỗi hiện banner, thành công `router.refresh()`.
  - Ghi chú dưới bảng: "Đơn PAID không hủy được trong bản demo (không hoàn tiền) — spec §13.7."

- [ ] **2.5 Kiểm tra + commit.**
  ```bash
  npx vitest run tests/orders-seller.test.ts
  npm run lint
  npx tsc --noEmit
  ```
  Commit: `feat: seller quản lý đơn + hủy hoàn kho (Plan 3 T2)`

---

## Task 3: CRUD sản phẩm `/seller/products` + upload ảnh local + invalidate RAG

**Mục tiêu:** Seller tạo/sửa/xóa sản phẩm của mình; ảnh upload lưu `public/uploads`; SKU unique theo shop; tên/SKU đổi → index RAG của shop bị xóa để AI dùng dữ liệu mới.

**Files:**
- `lib/products/service.ts` (mới)
- `app/api/seller/products/route.ts` (POST), `app/api/seller/products/[id]/route.ts` (PATCH, DELETE), `app/api/seller/products/upload/route.ts` (POST)
- `app/seller/products/page.tsx` (mới), `components/products/SellerProductsClient.tsx` (mới)
- `tests/products-service.test.ts` (mới)

**Interfaces:**

```ts
// lib/products/service.ts
export type ProductsPrisma = PrismaClient;

export type ProductInput = {
  sku: string;      // trim + upper; /^[A-Z0-9][A-Z0-9_-]{1,19}$/ (2–20 ký tự)
  name: string;     // trim 1..120
  price: number;    // int 0..100_000_000
  stock: number;    // int 0..100_000
  imageUrl: string | null; // null hoặc bắt đầu bằng "/uploads/"
};

/** Ném ApiError(400, thông điệp tiếng Việt) nếu sai; trả input đã chuẩn hóa. */
export function parseProductInput(value: unknown): ProductInput;

export async function listShopProducts(prisma: ProductsPrisma, shopId: string): Promise<Product[]>; // sku asc
export async function createProduct(prisma: ProductsPrisma, shopId: string, input: ProductInput): Promise<Product>;
/** 404 nếu id không thuộc shop; P2002 [shopId, sku] → 409 "SKU đã có trong shop này". */
export async function updateProduct(prisma: ProductsPrisma, shopId: string, productId: string, input: ProductInput): Promise<Product>;
/** 404 nếu không thuộc shop; đã có Order tham chiếu → 409 "Sản phẩm đã có đơn — không xoá được". */
export async function deleteProduct(prisma: ProductsPrisma, shopId: string, productId: string): Promise<void>;
```

**Steps:**

- [ ] **3.1 Test trước — `tests/products-service.test.ts`.**
  - `parseProductInput`: sku lowercase → upper; sku rỗng/ký tự lạ/quá dài → 400; price/stock âm hoặc không nguyên → 400; imageUrl `javascript:`/đường dẫn lạ → 400.
  - create/list/update/delete happy path; shop B không thấy/sửa/xóa được SP shop A (404).
  - Tạo trùng SKU trong cùng shop → 409; cùng SKU ở 2 shop khác nhau OK.
  - Xóa SP chưa có đơn OK; SP đã có order → 409.
  - Invalidate: seed 1 KB entry + 1 product, `retrieve` với fake embedder (copy khuôn `tests/rag-index.test.ts`, nhớ `invalidateAllShopIndexes()` trong `beforeEach`); `updateProduct` đổi `name` + `sku` → `retrieve` lại thấy tên mới (index được dựng lại).

- [ ] **3.2 Viết service.** Chuẩn hóa input trước khi ghi; dùng `prisma.product.create` và bắt `Prisma.PrismaClientKnownRequestError` code P2002 **chỉ khi** xác nhận trùng `[shopId, sku]` (đọc lại `findUnique({ shopId_sku })`) — không nuốt P2002 lạ. Gọi `invalidateShopIndex(shopId)` sau mỗi mutation thành công. Lưu ý: `updateProduct` kiểm tra `findFirst({ id, shopId })` trước (404), rồi update theo id. `deleteProduct`: nếu `order.count > 0` → 409; vẫn bắt `P2003` (FK) → 409 cùng thông điệp (đua hiếm: đơn vừa tạo giữa count và delete).

- [ ] **3.3 API routes.**
  - `POST /api/seller/products`: body JSON → `parseProductInput` → `createProduct(shop.id, ...)` → 201 `{ product }`.
  - `PATCH /api/seller/products/[id]`: như trên → `{ product }`.
  - `DELETE /api/seller/products/[id]`: → 204 rỗng (hoặc `{ ok: true }`).
  - `POST /api/seller/products/upload`: `requireUser("SELLER")` + `requireSellerShop` (nhất quán quyền); `request.formData()`; `file instanceof File`; chỉ `image/jpeg|png|webp`; ≤ 2 MB; tên mới `${randomUUID()}${ext}`; ghi `public/uploads` (tạo thư mục nếu thiếu); trả `{ url: "/uploads/<name>" }`. Không tin `file.name` (path traversal).

- [ ] **3.4 Trang `/seller/products` + client.**
  - Guard seller chuẩn; `listShopProducts` server-side; truyền xuống client.
  - `SellerProductsClient`: bảng (ảnh thumbnail hoặc khối chữ cái đầu, tên, SKU, giá, kho, nút Sửa/Xóa); form thêm/sửa (các ô SKU, tên, giá, kho, ảnh).
  - Ảnh: input `type="file"` → upload ngay khi chọn, hiện preview, lưu `url` vào state; nút "Bỏ ảnh" đặt `imageUrl = null`.
  - Submit → POST/PATCH; DELETE có confirm; lỗi server hiện banner; thành công đóng form + `router.refresh()`.
  - Ghi chú UI: "Sửa tên/SKU sẽ làm AI dùng dữ liệu mới ngay ở câu hỏi kế tiếp."

- [ ] **3.5 Kiểm tra + commit.**
  ```bash
  npx vitest run tests/products-service.test.ts tests/rag-index.test.ts
  npm run lint
  npx tsc --noEmit
  ```
  Commit: `feat: CRUD sản phẩm + upload ảnh + invalidate RAG (Plan 3 T3)`

---

## Task 4: CRUD KB `/seller/kb` — sửa KB là AI trả lời khác ngay

**Mục tiêu:** Seller quản lý mục kiến thức của shop; mọi thay đổi xóa index RAG của shop để câu trả lời kế tiếp dùng nội dung mới (tiêu chí §12).

**Files:**
- `lib/kb/service.ts` (mới)
- `app/api/seller/kb/route.ts` (POST), `app/api/seller/kb/[id]/route.ts` (PATCH, DELETE)
- `app/seller/kb/page.tsx` (mới), `components/kb/SellerKbClient.tsx` (mới)
- `tests/kb-service.test.ts` (mới)

**Interfaces:**

```ts
// lib/kb/service.ts
export type KbPrisma = PrismaClient;
export type KbInput = { title: string; answer: string }; // title 1..120, answer 1..4000 (trim)

export function parseKbInput(value: unknown): KbInput;
export async function listShopKb(prisma: KbPrisma, shopId: string): Promise<KbEntry[]>; // updatedAt desc
export async function createKbEntry(prisma: KbPrisma, shopId: string, input: KbInput): Promise<KbEntry>;
export async function updateKbEntry(prisma: KbPrisma, shopId: string, id: string, input: KbInput): Promise<KbEntry>;
export async function deleteKbEntry(prisma: KbPrisma, shopId: string, id: string): Promise<void>;
```

**Steps:**

- [ ] **4.1 Test trước — `tests/kb-service.test.ts`.**
  - `parseKbInput` trim + chặn rỗng/quá dài.
  - CRUD happy path; shop B không thấy/sửa/xóa entry shop A (404).
  - Xóa được entry không tham chiếu.
  - Freshness: tạo entry title "Chính sách đổi trả", `retrieve` (fake embedder) với query trùng title cũ → thấy entry; `updateKbEntry` đổi title thành "Đổi trả 7 ngày" → `retrieve` lại **không còn title cũ**, thấy title mới; tương tự sau `deleteKbEntry` (không còn entry). `invalidateAllShopIndexes()` trong `beforeEach`.

- [ ] **4.2 Viết service + 2 route + trang.** Service gọi `invalidateShopIndex(shopId)` sau create/update/delete. Route theo khuôn Task 3 (`requireUser("SELLER")` → `requireSellerShop`). Trang: danh sách card (title + answer rút gọn + ngày cập nhật), form thêm/sửa với textarea, xóa có confirm; lỗi/thành công như Task 3.

- [ ] **4.3 Kiểm tra + commit.**
  ```bash
  npx vitest run tests/kb-service.test.ts tests/rag-index.test.ts
  npm run lint
  npx tsc --noEmit
  ```
  Commit: `feat: CRUD KB + AI cập nhật ngay (Plan 3 T4)`

---

## Task 5: Dashboard `/seller`, khối Hiệu quả AI, popup kết thúc live, seed trace

**Mục tiêu:** Dashboard đọc số thật từ DB theo bộ lọc Hôm nay/7/30 ngày; biểu đồ doanh thu theo giờ; top 5 SP; khối AI; popup Studio mở được Dashboard. Seed lịch sử có trace để khối AI (thời gian trả lời) có số ngay khi mở.

**Files:**
- `lib/chat/stats.ts` (export helper giờ VN)
- `lib/dashboard/service.ts` (mới)
- `app/seller/page.tsx` (mới), `components/dashboard/RevenueChart.tsx` (mới — server component, SVG thuần)
- `components/studio/EndLiveDialog.tsx` (bật nút Dashboard)
- `prisma/seed/history.ts` (trace cho tin AI)
- `tests/dashboard-service.test.ts` (mới)

**Interfaces:**

```ts
// lib/chat/stats.ts (thay đổi nhỏ)
export function vietnamHour(at: Date): number;
export function isNightHour(hour: number): boolean; // hour >= 22 || hour < 6

// lib/dashboard/service.ts
export type DashboardRange = "today" | "7d" | "30d";
export type DashboardStats = {
  revenue: number; // sum(total) where paidAt != null trong khoảng
  orderCounts: { pending: number; paid: number; shipped: number; cancelled: number }; // theo createdAt
  unitsSold: number;   // sum(qty) của đơn paidAt != null
  peakViewers: number; // max(peakViewers) phiên có startedAt trong khoảng (0 nếu không có)
  hourlyRevenue: { hour: number; revenue: number }[]; // 24 phần tử, giờ VN của paidAt
  topProducts: { sku: string; name: string; qty: number; revenue: number }[]; // tối đa 5, qty desc rồi revenue desc
  ai: {
    conversations: number;       // distinct hội thoại có ≥1 tin AI trong khoảng
    nightConversations: number;  // như trên, giờ VN ∈ [22,6)
    avgResponseMs: number | null; // trung bình trace.elapsedMs của tin AI trong khoảng; null nếu không có trace
    topQuestions: { text: string; count: number }[]; // tối đa 5, tin BUYER trong khoảng
  };
};

/** Biên khoảng theo lịch VN (UTC+7, không DST); 7d/30d tính cả hôm nay. */
export function rangeBounds(
  range: DashboardRange,
  now?: Date,
): { start: Date; end: Date };

export async function getDashboardStats(
  prisma: PrismaClient,
  shopId: string,
  range: DashboardRange,
  now?: Date,
): Promise<DashboardStats>;
```

**Steps:**

- [ ] **5.1 Export helper giờ VN.** Đổi `function vietnamHour` → `export function vietnamHour`; thêm `isNightHour`; `countAiConversationsAtNight` dùng `isNightHour`. Chạy `npx vitest run tests/chat-stats.test.ts` (không đổi hành vi).

- [ ] **5.2 Test trước — `tests/dashboard-service.test.ts`.**
  - Fixture: 1 shop A + 1 shop B; products; orders với `createdAt`/`paidAt` ghim:
    - hôm nay (paidAt 10:00 VN), 3 ngày trước, 20 ngày trước (đều PAID);
    - 1 PENDING hôm nay, 1 CANCELLED hôm nay, 1 SHIPPED 2 ngày trước (có paidAt);
    - 1 đơn shop B hôm nay (không được lọt vào số shop A).
  - `now = 2026-10-21T10:00:00Z` (17:00 VN). `rangeBounds("today")` → start `2026-10-20T17:00:00Z`, end = now; `7d` start `2026-10-14T17:00:00Z` (6 ngày trước todayStart); `30d` start `2026-09-21T17:00:00Z` (29 ngày trước todayStart).
  - Doanh thu: today = đơn hôm nay; 7d = +3 ngày trước; 30d = +20 ngày trước; đơn shop B không tính; SHIPPED có paidAt được tính; PENDING/CANCELLED không.
  - `orderCounts` đếm theo createdAt; `unitsSold` = tổng qty đơn đã thu; `peakViewers` = max phiên trong khoảng (tạo 2 phiên: 12 và 40 → 40; phiên ngoài khoảng không tính).
  - `hourlyRevenue`: 24 phần tử; đơn paidAt 10:00 VN vào bucket 10; tổng các bucket = revenue.
  - `topProducts`: đúng thứ tự qty desc, tối đa 5, chỉ đơn đã thu.
  - AI: tạo 2 hội thoại cùng shop A (1 hội thoại có tin AI lúc **00:30 VN ngày 21/10** = `2026-10-20T17:30:00Z`, vẫn trong "Hôm nay" và là giờ đêm, trace `elapsedMs` 2000; thêm 1 tin AI ban ngày trace 1000; 1 hội thoại ngày khác trace 3000), 1 hội thoại shop B; tin BUYER lặp "Size nào?" 2 lần + "Phí ship?" 1 lần.
    - `conversations` = 2 (shop A), `nightConversations` = 1, `avgResponseMs` = 2000 (trung bình 2000,1000,3000), `topQuestions` = [{ text: "Size nào?", count: 2 }, { text: "Phí ship?", count: 1 }] (thứ tự count desc) — các assert AI dùng `range = "today"` và `now` ở trên.
    - Tin AI không có trace (lịch sử cũ) không làm hỏng — nếu tất cả đều không trace thì `avgResponseMs = null`.

- [ ] **5.3 Viết `lib/dashboard/service.ts`.** Biên ngày VN dùng offset cố định (VN không có DST):
  ```ts
  const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
  const DAY_MS = 24 * 60 * 60 * 1000;
  function vnDayStart(at: Date): Date {
    const shifted = at.getTime() + VN_OFFSET_MS;
    return new Date(Math.floor(shifted / DAY_MS) * DAY_MS - VN_OFFSET_MS);
  }
  // today: start = vnDayStart(now); 7d: start - 6 ngày; 30d: start - 29 ngày; end = now
  ```
  Thực hiện các query song song (`prisma.$transaction([...])` hoặc `Promise.all`): orders (paidAt/createdAt), sessions, messages. Với AI messages chỉ `select { conversationId, createdAt, trace }` rồi lọc bằng JS (`vietnamHour`, `readTrace`) — quy mô demo, tránh SQL phức tạp; `avgResponseMs` chỉ tính các tin có trace đọc được. `topQuestions`: Map key = nội dung trim + gộp khoảng trắng + lowercase; giữ `text` gốc **mới nhất** để hiển thị; sort count desc rồi text asc.

- [ ] **5.4 Trang `/seller` + components.**
  - Guard seller chuẩn; `searchParams.range` chỉ nhận `today|7d|30d` (mặc định `7d` — có số seed ngay; giá trị lạ → `7d`).
  - Header: tiêu đề "📊 Dashboard", 3 nút filter dạng `Link` (`?range=...`), nút active nổi bật.
  - 4 KPI card: Doanh thu thực thu (note "đơn đã thu tiền — PAID/SHIPPED"); Đơn theo trạng thái (4 chip PENDING/PAID/SHIPPED/CANCELLED); SP đã bán (units) + số đơn trong khoảng; Đỉnh người xem.
  - `RevenueChart`: SVG cột 24 giờ, nhãn trục 0/6/12/18/23, `<title>` mỗi cột ("10h — 300.000đ"), empty state "Chưa có doanh thu trong khoảng này".
  - Top 5 SP: bảng hạng, SKU + tên, số lượng, doanh thu.
  - Khối "🤖 Hiệu quả AI": 2 số hội thoại (tổng/đêm), thời gian trả lời TB (nếu `avgResponseMs === null` hiện "—", ngược lại hiện giây với 1 chữ số thập phân), danh sách câu hỏi phổ biến kèm số lần; ghi chú "Số liệu trong khoảng đang chọn, đọc trực tiếp từ DB."
  - Trang server render toàn bộ số; filter dùng `Link` trực tiếp trong page (không cần client component).

- [ ] **5.5 Bật nút Dashboard trong popup.** `components/studio/EndLiveDialog.tsx`: thay nút disabled bằng `<Link href="/seller">📊 Xem Dashboard chi tiết</Link>` (style giữ nguyên); xóa copy "Plan 3". Studio đóng dialog khi điều hướng (Link tự chuyển trang).

- [ ] **5.6 Seed trace lịch sử.** Trong `prisma/seed/history.ts`:
  - `SeedHistoryMessage` thêm `trace?: AiTrace` (import type từ `../../lib/chat/trace`).
  - Mọi tin `source: AI` thêm trace hợp lệ: `model: "qwen/qwen3.8-27b"`, `topK` trỏ đúng SEED_IDS.kb/… (title thật của KB seed), `products` đúng SKU/giá/kho seed, `tokens` hợp lý, `elapsedMs` 1200–2600, `liveSessionId` chỉ khi hợp lý (bỏ trống được).
  - Trong vòng upsert tin nhắn: `messageFields` thêm `trace: message.trace` (undefined với tin không AI).
  - Chạy `npm run seed` 2 lần liên tiếp → không lỗi, số tin không đổi (idempotent theo id).

- [ ] **5.7 Kiểm tra + commit.**
  ```bash
  npx vitest run tests/dashboard-service.test.ts tests/chat-stats.test.ts tests/seed-history.test.ts
  npm run lint
  npx tsc --noEmit
  ```
  Commit: `feat: Dashboard + hiệu quả AI + seed trace (Plan 3 T5)`

---

## Task 6: Seller nav + dọn minor Plan 1/2 (đã xác minh còn mở)

**Mục tiêu:** Seller điều hướng được giữa 6 màn hình; sửa các minor đã hoãn có rủi ro demo thấp mà không đổi kiến trúc.

**Files:**
- `components/home/HomeHeader.tsx` (seller nav)
- `hooks/useInboxSocket.ts`, `components/inbox/SellerInboxClient.tsx` (background update + reset aiThinking)
- `lib/chat/format.ts` (mới), `components/inbox/InboxClient.tsx`, `components/inbox/SellerInboxClient.tsx` (dùng helper)
- `lib/chat/flow.ts` (history không lặp câu hỏi hiện tại)
- `lib/chat/ai.ts`, `lib/rag/groq.ts` (model fallback theo env)
- `lib/chat/gateway.ts` (cap `clientNonce`)
- `package.json` (dotenv → dependencies; bỏ `@types/bcryptjs`)
- `tests/chat-gateway.test.ts`, `tests/chat-ai.test.ts` (cập nhật/thêm test)
- `public/*.svg` (xóa file scaffold không dùng — nếu grep xác nhận không tham chiếu)

**Steps:**

- [ ] **6.1 Seller nav trong `HomeHeader`.** Khi `user.role === "SELLER"`, render nav (wrap, scroll ngang được trên hẹp) với `Link`: 📊 Dashboard `/seller`, 🎥 Studio `/seller/studio`, 💬 Inbox `/seller/inbox`, 🛍️ Sản phẩm `/seller/products`, 📚 KB `/seller/kb`, 🧾 Đơn `/seller/orders`. Active state bằng `usePathname()` (Dashboard chỉ active khi pathname đúng `/seller`; các mục con dùng `startsWith`). BUYER giữ Inbox + Đơn của tôi (đã thêm ở Task 1). Không đổi logic logout.

- [ ] **6.2 Dedup format.** Tạo `lib/chat/format.ts`:
  ```ts
  export function formatWhen(iso: string): string; // hôm nay HH:mm, cũ hơn dd/MM HH:mm
  export function previewText(
    lastMessage: { source: "BUYER" | "SELLER" | "AI" | "SYSTEM"; content: string } | null,
    perspective: "buyer" | "seller",
  ): string;
  ```
  Buyer: BUYER → "Bạn:", SELLER → "Nhân viên shop:", empty → "Chưa có tin nhắn — bắt đầu trò chuyện nhé". Seller: BUYER → "Khách:", SELLER → "Bạn:", empty → "Chưa có tin nhắn — khách chưa nhắn gì". Xóa bản copy trong 2 component, dùng helper (giữ nguyên output như hiện tại).

- [ ] **6.3 Prompt không lặp câu hỏi hiện tại.** `lib/chat/flow.ts`: `getMessages(..., { take: HISTORY_TAKE + 1 })` rồi `history.filter((row) => row.id !== buyerRow.id).slice(-HISTORY_TAKE)` trước khi map. Cập nhật `tests/chat-gateway.test.ts` dòng assert history mới nhất: hội thoại chỉ có câu hỏi hiện tại → `history` là `[]` (trước là `["BUYER"]`); thêm case: có 1 tin cũ trước đó → history chỉ còn tin cũ.

- [ ] **6.4 Model fallback theo env.** `lib/rag/groq.ts` thêm:
  ```ts
  export function resolveGroqModel(override?: string): string {
    return override ?? process.env.GROQ_MODEL ?? DEFAULT_GROQ_MODEL;
  }
  ```
  `chatCompletion` dùng `resolveGroqModel(opts.model)`. `lib/chat/ai.ts` nhánh fallback trace dùng `resolveGroqModel()` thay `DEFAULT_GROQ_MODEL`. Thêm test trong `tests/rag-groq.test.ts` (đặt `GROQ_MODEL` tạm, khôi phục sau) hoặc `tests/chat-ai.test.ts`: trace fallback mang model từ env.

- [ ] **6.5 Seller list cập nhật realtime + aiThinking reset.**
  - `useInboxSocket(token, seed, options?: { onBackgroundMessage?: (event: InboxMessageEvent) => void; onBackgroundConversation?: (event: InboxConversationEvent) => void })`: trong `handleMessage`/`handleConversationUpdated`, nếu sự kiện thuộc hội thoại KHÁC seed hiện tại → gọi callback tương ứng (rồi return như cũ). Không đổi hành vi hội thoại đang mở. Giữ callbacks trong `ref` (cập nhật qua `useEffect`) để không đưa vào dependency của effect mở socket — tránh reconnect mỗi lần render.
  - `SellerInboxClient`: chuyển `conversations` prop thành state `rows` (khởi tạo từ prop, sync khi prop đổi bằng `useEffect`); callback cập nhật `lastMessage`/`mode`/`activityAt` cho đúng dòng; id lạ (hội thoại mới) → `router.refresh()` để server thêm dòng. Vẫn merge tin mới nhất của hội thoại đang mở vào dòng active như hiện tại; giữ sort theo `activityAt`.
  - Reset spinner: trong `handleDisconnect` (và `connect_error`) `setChat(prev => prev ? { ...prev, aiThinking: false } : prev)`. **Không** làm backfill (đã ghi mục Giới hạn đã biết).
  - Test hook/UI không có hạ tầng DOM — kiểm thử thủ công bằng 2 cửa sổ; ghi vào report Task 6.

- [ ] **6.6 Cap `clientNonce`.** `lib/chat/gateway.ts`: `MAX_NONCE_LENGTH = 100`; `parseNonce` trả `undefined` nếu dài hơn (coi như không có nonce). Thêm test trong `tests/chat-gateway.test.ts`: gửi 2 tin cùng nội dung với nonce 101 ký tự → cả 2 đều lưu (không dedup nhầm); nonce 20 ký tự vẫn dedup như cũ.

- [ ] **6.7 Dọn dependency/file scaffold.**
  - `package.json`: chuyển `dotenv` từ devDependencies → dependencies (`server.ts` import khi `npm start` production); xóa `@types/bcryptjs` (bcryptjs 3 đã có types) — chạy `npm install` để cập nhật lockfile, `npx tsc --noEmit` xác nhận.
  - Xóa `public/file.svg`, `globe.svg`, `next.svg`, `vercel.svg`, `window.svg` **nếu** grep toàn repo không còn tham chiếu.

- [ ] **6.8 Kiểm tra + commit.**
  ```bash
  npx vitest run tests/chat-gateway.test.ts tests/chat-ai.test.ts tests/rag-groq.test.ts
  npm run lint
  npx tsc --noEmit
  ```
  Commit: `chore: seller nav + dọn minor Plan 1/2 (Plan 3 T6)`

---

## Task 7: Đóng gói demo — README, chạy sạch, kiểm thử §10/§12

**Mục tiêu:** Người khác clone máy mới chạy được theo README; toàn bộ kịch bản §10 chạy hết bằng 2 cửa sổ; bảng nghiệm thu §12 có bằng chứng; kịch bản demo giấy cập nhật.

**Files:**
- `README.md`
- `.superpowers/sdd/<workspace>/task-7-report.md` (báo cáo bằng chứng — khi thực thi SDD)
- (chỉ sửa code nếu smoke phát hiện lỗi; lỗi nào sửa xong phải có test/ghi chú)

**Steps:**

- [ ] **7.1 Cập nhật README.**
  - Trạng thái: Plan 3 hoàn tất (3/3).
  - Quickstart: thêm ghi chú `qrcode` (không cần mạng), 3 biến `DEMO_BANK_*`, `DEMO_MODE=true` cho nút giả lập.
  - Mục mới "Đơn hàng & thanh toán demo": luồng PENDING → QR → giả lập → PAID + tin SYSTEM; nói rõ không chuyển tiền thật; PAID không hủy được.
  - Mục "Quản trị shop": sản phẩm (upload `public/uploads`, giới hạn 2 MB, jpg/png/webp), KB (sửa → AI đổi ngay), đơn (giao/hủy hoàn kho).
  - Mục "Dashboard": định nghĩa từng chỉ số (doanh thu `paidAt != null` gồm SHIPPED; đơn theo `createdAt`; đỉnh người xem; AI theo khoảng lọc; câu hỏi phổ biến từ tin BUYER).
  - Kịch bản demo §10 bản đầy đủ (thêm bước `/orders` thanh toán + Dashboard + sửa KB tại chỗ + phương án dự phòng Groq/webcam/mất mạng).
  - Mục "Giới hạn đã biết": backfill sau reconnect, `npm audit` 5 high transitive, index RAG trong RAM.
  - Bảng "Đã kiểm thử trình duyệt" (những gì Plan 3 smoke) + "Cần người dùng click-through" (webcam/mic, layout projector) — trung thực, không đánh dấu đã xác minh khi chưa.

- [ ] **7.2 Chạy sạch từ trạng thái seed.**
  ```bash
  npm run seed
  npx next typegen
  npx tsc --noEmit
  npm run lint
  npm test
  npm run build
  ```
  `npm run build` cần DB đang chạy + `.env`; nếu build lỗi vì môi trường, ghi rõ lỗi vào report và xử lý (không bỏ qua im lặng). Việc "máy mới" không thể xác minh tuyệt đối trong session này — ghi rõ là ⚠️ trong §12, kèm bằng chứng quy trình đã chạy lại từ seed trên máy hiện tại.

- [ ] **7.3 Smoke 2 cửa sổ theo §10 (real Groq).** Seller thường + Khách incognito; chạy đủ 9 bước, ghi transcript ngắn + ảnh chụp nếu có. Bắt buộc xác nhận:
  - Đơn live PENDING → `/orders` có QR + thanh toán → PAID ngay, tin SYSTEM ở Inbox khách, seller thấy hội thoại nhảy lên đầu (Task 6).
  - Seller `/seller/orders`: hủy 1 đơn PENDING mới → kho +qty trên `/seller/products`; đơn PAID không có nút hủy.
  - `/seller/products`: tạo SP mới + upload ảnh; sửa tên → hỏi AI về SP đó thấy tên mới.
  - `/seller/kb`: sửa "đổi trả" → hỏi lại trong Inbox thấy câu trả lời mới (RAG freshness).
  - Dashboard: filter Hôm nay/7/30 ra số khác nhau; doanh thu tăng sau khi thanh toán; top SP khớp; khối AI có số (avg không "—" nhờ seed trace).
  - Popup kết thúc live → nút "Xem Dashboard chi tiết" hoạt động.
  - Tái xác nhận 2 cốt lõi Plan 1/2 không hồi quy (Aho-Corasick + takeover).
- [ ] **7.4 Đối chiếu §12.** Chép nguyên checklist §12 vào report, đánh dấu ✅/⚠️ kèm bằng chứng (test name, transcript, hoặc "chưa xác minh trình duyệt — cần người dùng"). Không tô hồng.
- [ ] **7.5 Commit cuối:** `docs: đóng gói demo Plan 3 + README (Plan 3 T7)`.

---

## Thứ tự & phụ thuộc

```
T1 (buyer orders/QR/pay) ──► T2 (seller orders)  [dùng chung lib/orders/service.ts]
T3 (products) ─┐
T4 (KB) ───────┴─► T5 (dashboard) ─► T6 (nav + minors) ─► T7 (đóng gói)
```
T3/T4 độc lập với T2, có thể đảo thứ tự; T5 cần order/KB/product service đã có để smoke. T6 làm sau cùng vì chạm nhiều file UI/hook.

## Quy trình thực thi

- Làm trong worktree riêng (`plan3/orders-dashboard-crud`) trên `master`, theo `superpowers:using-git-worktrees` + `subagent-driven-development` (hoặc `executing-plans` nếu chạy tuần tự trong session).
- Mỗi task: test đỏ → code → test xanh → `npm run lint` + `npx tsc --noEmit` → commit; ghi report `.superpowers/sdd/2026-10-21-liveorder-plan3-orders-dashboard-crud/task-N-report.md`.
- Kết thúc: review toàn nhánh → sửa theo review → `npm install` + `npm test` trên `master` sau merge → xóa worktree/branch, lưu ledger (cùng quy trình Plan 2).

## Definition of Done (toàn Plan 3)

- [ ] 5 file test mới + các test cập nhật xanh; `npm test` toàn bộ xanh offline.
- [ ] `npx tsc --noEmit` + `npm run lint` sạch; `npm run build` chạy được (hoặc lỗi môi trường có ghi chú).
- [ ] Không còn chuỗi "Plan 3" trong UI (grep `Plan 3` chỉ còn trong docs).
- [ ] §12 có bảng đối chiếu; §10 smoke 2 cửa sổ có transcript.
- [ ] README đủ để người khác chạy từ máy mới (docker → install → migrate/seed → dev).
