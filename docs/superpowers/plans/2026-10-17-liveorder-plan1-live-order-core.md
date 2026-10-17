# LiveOrder Demo (Next.js) — Plan 1: Nền tảng & Cốt lõi ① (Live + Chốt đơn) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dựng nền tảng app Next.js (auth, DB, seed 2 shop có lịch sử) và Cốt lõi ①: livestream realtime — comment được che SĐT, thuật toán Aho-Corasick bắt SKU (highlight + đo ms), tạo đơn + trừ kho nguyên tử, Studio seller và màn xem live kiểu TikTok cho khách.

**Architecture:** Một app Next.js (App Router) + custom server (`server.ts`) gắn socket.io (Plan 1 dùng namespace `/live`; `/inbox` để Plan 2). Prisma + PostgreSQL chạy Docker. Toàn bộ logic nghiệp vụ nằm trong `lib/` dạng hàm thuần (parser, mask, order/session service, auth) để test độc lập; route handlers và gateway chỉ là lớp mỏng. Test: Vitest — unit cho lib thuần, integration trên PostgreSQL test riêng, gateway test bằng `socket.io-client` thật.

**Tech Stack:** Next.js (15+, App Router), TypeScript, Tailwind CSS, socket.io + socket.io-client, Prisma + PostgreSQL (Docker Compose), jose (JWT), bcryptjs, tsx (chạy custom server + seed), Vitest, dotenv.

**Spec:** `docs/superpowers/specs/2026-10-16-liveorder-nextjs-demo-design.md` — plan này thực thi phần M1 + M2 của spec (mục 4–7, 9, 14). Người thực thi đọc kèm spec.

---

## Global Constraints (áp cho MỌI task)

- UI **tiếng Việt**. Tiền là **số nguyên VND** (`Int`), không dùng Float.
- **Danh tính (HTTP + Socket) LUÔN lấy từ JWT**; tuyệt đối không tin `buyerId`/`userId`/`role` trong payload client (spec §7.1).
- **Che SĐT SERVER-SIDE** trước khi broadcast bất kỳ comment nào (spec §7.2). Thứ tự pipeline cố định: che SĐT → parse Aho-Corasick trên **chuỗi đã che** (vị trí highlight tính theo chuỗi phát đi) → phát.
- **Không gọi AI** cho comment livestream — Plan 1 không có AI (spec §7.3).
- Trừ kho **atomic**: một lệnh `UPDATE ... WHERE stock >= qty` trong transaction (spec §6). Hủy đơn hoàn kho cùng transaction (task này chỉ cần chiều trừ; chiều hoàn ở Plan 3).
- `eventId` **unique** chống tạo đơn trùng; `paymentCode` **unique** (spec §6).
- **Doanh thu trong demo** = tổng `total` các đơn **đã thu tiền** (`paidAt != null` — gồm PAID và SHIPPED; KHÔNG tính PENDING/CANCELLED). Đây là cách hiểu nhất quán cho "doanh thu = tổng đơn PAID" ở spec §7.10/§12 (đơn SHIPPED cũng đã thu tiền) — dùng chung ở popup tổng kết (Task 11/13) và Dashboard (Plan 3, ghi chú ngay dưới KPI).
- Aho-Corasick **word-boundary**: `SP01` KHÔNG khớp trong `SP010` (spec §7.7).
- Seed dùng **UUID cố định** trong một hằng số `SEED_IDS` (spec §6, §9); seed chạy lại được (upsert).
- Nghiệm thu nào cũng kèm **số thật đo được** (ms parser và số liệu khác không hard-code — spec §13.4).
- Test DB: PostgreSQL riêng `liveorder_test` (cần `docker compose up -d` trước khi test).
- Node ≥ 20 (máy dev đang có 22 — ok). Chạy được trên Windows (dev qua Git Bash/PowerShell đều ổn; tránh script chỉ-chạy-được trên Unix).
- Commit theo Conventional Commits, sau mỗi task.

## Review Focus (5 nhóm lỗi dễ “cắn” nhất — mỗi nhóm có test ở task tương ứng)

1. **Comment trùng do retry/lag** (double-click, gửi lại khi mạng chậm) → phải chỉ 1 đơn duy nhất (test `eventId` dedupe — Task 9).
2. **SĐT biến thể** (`+84 912 345 678`, `0912 345 678`, `0912.345.678`) → che hết trước broadcast (test các biến thể — Task 7, và test vị trí highlight vẫn đúng sau khi che — Task 9).
3. **SKU lồng nhau / gõ lệch** (`SP010` chứa `SP01`, `sp01`, khoảng trắng, text Unicode quanh) → chỉ bắt mã đúng ranh giới từ (test — Task 8).
4. **Hai khách cùng chốt khi kho = 1** → đúng 1 đơn thành công, kho không âm (test concurrency — Task 9).
5. **Giả mạo danh tính socket** (payload `buyerId`/`userId` khác với JWT) → đơn và comment ghi nhận đúng user trong JWT (test — Task 10).

---

## Phạm vi HOÃN sang Plan 2/3 — KHÔNG làm trong plan này

- Toàn bộ AI/RAG/Inbox (embedding, Groq, chip nguồn, Truy vết RAG, takeover, tra đơn, dây A/B/C) — **Plan 2**.
- Trang `/inbox` thật (Plan 1 chỉ tạo placeholder nêu rõ “sẽ có ở Plan 2”).
- CRUD Sản phẩm/KB (UI), trang `/orders` + thanh toán giả lập + tin SYSTEM, quản lý đơn seller, Dashboard + khối Hiệu quả AI, nút “💬 Nhắn tin” ở Trang chủ (mở hội thoại), QR — **Plan 3**.
- Embedding spike (M1 của spec) — dời sang **Plan 2 Task 1** vì chỉ chặn phần AI (ghi chú trong plan đó).

---

### Task 1: Khởi tạo dự án Next.js + Tailwind + Vitest

**Files:**
- Create: toàn bộ scaffold Next.js ở thư mục gốc; `vitest.config.ts`; `tests/smoke.test.ts`; `.env.example`; `README.md` (stub); sửa `app/page.tsx`, `app/layout.tsx`.
- Modify: `package.json` (scripts).

**Interfaces:**
- Consumes: repo git đã có (commit `docs:` đầu tiên).
- Produces: dự án chạy `npm run dev`; `npm test` chạy Vitest; alias `@/*` → gốc dự án; `.env.example` với các key: `DATABASE_URL`, `TEST_DATABASE_URL`, `JWT_SECRET`, `DEMO_MODE=true`, `GROQ_API_KEY=` (để trống cho Plan 2), `PORT=3000`.

- [ ] **Step 1: Scaffold Next.js an toàn với thư mục đã tồn tại**

```bash
npx create-next-app@latest _scaffold --typescript --tailwind --eslint --app --no-src-dir --import-alias "@/*" --use-npm --no-turbopack
```
(Nếu cờ đã đổi ở phiên bản mới: chọn tương ứng TypeScript + Tailwind + App Router + no src dir + alias `@/*`.) Sau đó **chuyển toàn bộ file trong `_scaffold/`** (kể cả file ẩn, trừ `.git`) vào thư mục gốc, xóa `_scaffold`. Sửa `name` trong `package.json` thành `liveorder-demo`. Ghi lại version Next thực tế vào README (deviation nếu khác 15).

- [ ] **Step 2: Cài dependencies dự án**

```bash
npm i socket.io socket.io-client @prisma/client jose bcryptjs tsx cross-env
npm i -D prisma vitest dotenv @types/bcryptjs
```

- [ ] **Step 3: Thay trang chủ placeholder tiếng Việt**

`app/layout.tsx`: `lang="vi"`, metadata `LiveOrder Demo`. `app/page.tsx`: một trang tĩnh “LiveOrder — demo livestream bán hàng” (sẽ thay thật ở Task 12).

- [ ] **Step 4: Cấu hình Vitest**

`vitest.config.ts` (node environment, alias `@` → gốc, include `tests/**/*.test.ts`). `tests/smoke.test.ts`:

```ts
import { expect, test } from 'vitest'
test('vitest chạy được', () => { expect(1 + 1).toBe(2) })
```

Scripts `package.json`: `"test": "vitest run"`, `"test:watch": "vitest"`.

- [ ] **Step 5: Tạo `.env.example` + copy thành `.env` (local, không commit)**

Ghi rõ trong README: copy `.env.example` → `.env` và điền trước khi chạy.

- [ ] **Step 6: Chạy kiểm tra**

Run: `npm test` → PASS 1 test. Run: `npm run dev` → mở `http://localhost:3000` thấy trang tiếng Việt; Ctrl+C.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore: scaffold Next.js + Tailwind + Vitest"
```

---

### Task 2: PostgreSQL (Docker) + Prisma schema đầy đủ + hạ tầng test DB

**Files:**
- Create: `docker-compose.yml`; `prisma/schema.prisma`; `lib/db.ts`; `tests/global-setup.ts`; `tests/helpers/db.ts`; `tests/db.test.ts`; `public/uploads/.gitkeep`.
- Modify: `package.json` (scripts), `.env` (điền DATABASE_URL thật).

**Interfaces:**
- Consumes: `.env` từ Task 1.
- Produces: `prisma` client export mặc định từ `lib/db.ts` (`PrismaClient` singleton, hot-reload-safe); `testPrisma` và `resetDb()` từ `tests/helpers/db.ts` cho mọi integration test sau này.

- [ ] **Step 1: docker-compose.yml chỉ có Postgres**

```yaml
services:
  db:
    image: postgres:16-alpine
    ports: ["5433:5432"] # máy dev bận 5432 (project khác) — xem ledger R12
    environment:
      POSTGRES_USER: liveorder
      POSTGRES_PASSWORD: liveorder
      POSTGRES_DB: liveorder
    volumes: [pgdata:/var/lib/postgresql/data]
volumes: { pgdata: {} }
```

Chạy `docker compose up -d`. Tạo thêm database test: `docker compose exec db createdb -U liveorder liveorder_test`. Điền `.env`: `DATABASE_URL=postgresql://liveorder:liveorder@localhost:5433/liveorder`, `TEST_DATABASE_URL=…/liveorder_test` (port 5433 = máy dev thực tế, xem ledger R12; `.env.example` trong repo là chuẩn).

- [ ] **Step 2: Viết schema Prisma đầy đủ**

`prisma/schema.prisma` — đúng theo spec §6 (đây là giá trị cố định, chép nguyên):

```prisma
generator client { provider = "prisma-client-js" }
datasource db { provider = "postgresql"; url = env("DATABASE_URL") }

enum Role { BUYER SELLER }
enum ChatMode { AI HUMAN }
enum MessageSource { BUYER SELLER AI SYSTEM }
enum LiveStatus { LIVE ENDED }
enum OrderStatus { PENDING PAID SHIPPED CANCELLED }

model User {
  id String @id @default(uuid())
  email String @unique
  passwordHash String
  name String
  role Role
  createdAt DateTime @default(now())
  shop Shop?
  orders Order[] @relation("BuyerOrders")
}

model Shop {
  id String @id @default(uuid())
  name String
  avatarUrl String?
  ownerId String @unique
  owner User @relation(fields: [ownerId], references: [id])
  products Product[]
  kbEntries KbEntry[]
  sessions LiveSession[]
  orders Order[]
  conversations Conversation[]
}

model Product {
  id String @id @default(uuid())
  shopId String
  shop Shop @relation(fields: [shopId], references: [id])
  sku String
  name String
  price Int
  stock Int
  imageUrl String?
  createdAt DateTime @default(now())
  orders Order[]
  @@unique([shopId, sku])
}

model KbEntry {
  id String @id @default(uuid())
  shopId String
  shop Shop @relation(fields: [shopId], references: [id])
  title String
  answer String
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}

model LiveSession {
  id String @id @default(uuid())
  shopId String
  shop Shop @relation(fields: [shopId], references: [id])
  title String
  status LiveStatus @default(LIVE)
  startedAt DateTime @default(now())
  endedAt DateTime?
  peakViewers Int @default(0)
  orders Order[]
  @@index([shopId, status])
}

model Conversation {
  id String @id @default(uuid())
  buyerId String
  shopId String
  shop Shop @relation(fields: [shopId], references: [id])
  mode ChatMode @default(AI)
  version Int @default(1)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  messages DirectMessage[]
  @@unique([buyerId, shopId])
}

model DirectMessage {
  id String @id @default(uuid())
  conversationId String
  conversation Conversation @relation(fields: [conversationId], references: [id])
  source MessageSource
  content String
  dedupKey String? @unique
  orderId String?
  createdAt DateTime @default(now())
  @@index([conversationId, createdAt])
}

model Order {
  id String @id @default(uuid())
  code Int @unique @default(autoincrement())
  shopId String
  shop Shop @relation(fields: [shopId], references: [id])
  buyerId String
  buyer User @relation("BuyerOrders", fields: [buyerId], references: [id])
  productId String
  product Product @relation(fields: [productId], references: [id])
  qty Int
  unitPrice Int
  total Int
  status OrderStatus @default(PENDING)
  eventId String @unique
  paymentCode String @unique
  paidAt DateTime?
  liveSessionId String?
  liveSession LiveSession? @relation(fields: [liveSessionId], references: [id])
  createdAt DateTime @default(now())
  @@index([shopId, status])
  @@index([buyerId])
}
```

- [ ] **Step 3: Migrate + generate**

Run: `npx prisma migrate dev --name init` → tạo migration + client. Run: `npx prisma migrate status` → “Database schema is up to date”.

- [ ] **Step 4: `lib/db.ts` singleton**

```ts
import { PrismaClient } from '@prisma/client'
export const prisma = globalThis.__prisma ?? new PrismaClient()
if (process.env.NODE_ENV !== 'production') globalThis.__prisma = prisma
```
Kèm khai báo type cho `globalThis`.

- [ ] **Step 5: Hạ tầng test DB — viết test trước (đỏ), rồi cho chạy (xanh)**

`tests/global-setup.ts`: nạp `dotenv/config`; chạy `npx prisma migrate deploy` với `DATABASE_URL = process.env.TEST_DATABASE_URL` (dùng `execSync` + env override).
`tests/helpers/db.ts`: export `testPrisma` (PrismaClient trỏ `TEST_DATABASE_URL`) và `resetDb()` (chạy `TRUNCATE "DirectMessage","Order","Conversation","LiveSession","KbEntry","Product","Shop","User" RESTART IDENTITY CASCADE`).
`tests/db.test.ts` (integration): `beforeEach(resetDb)`; tạo 1 User qua `testPrisma`, đọc lại, assert tồn tại. Chạy `npm test` → PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: prisma schema đầy đủ + postgres docker + hạ tầng test DB"
```

---

### Task 3: Seed nền — SEED_IDS, 2 shop, sản phẩm, KB, tài khoản demo

**Files:**
- Create: `prisma/seed/ids.ts`; `prisma/seed/data.ts`; `prisma/seed/index.ts`; `prisma/seed/base.ts`; `tests/seed-base.test.ts`.
- Modify: `package.json` (`"seed": "tsx prisma/seed/index.ts"`).

**Interfaces:**
- Consumes: `lib/db.ts`, schema Task 2.
- Produces: `SEED_IDS` (const object, ví dụ `SEED_IDS.users.khach` / `.hong` / `.minh` / `.linh` / `.baoan`, `SEED_IDS.shops.linh`, `SEED_IDS.products.linh_sp01`, `SEED_IDS.kb.linh_size` … — mọi id cố định dạng UUID v4 viết cứng); `seedBase(prisma)` (upsert users/shops/products/kb). Mật khẩu demo: `demo123` (bcrypt hash khi seed; README ghi rõ email + mật khẩu).

- [ ] **Step 1: Viết test trước (đỏ)**

`tests/seed-base.test.ts` (integration, `resetDb`): chạy `seedBase(testPrisma)` 2 lần liên tiếp; assert: **5 user** (khach + 2 khách phụ Hồng/Minh Tú — BUYER; linh/baoan — SELLER); 2 shop đúng owner; shop Linh 7 sản phẩm đúng bộ SKU `SP01…SP07` với giá/kho đúng spec §9 (SP01 150.000/kho 8; SP06 320.000/kho 3; …); shop Bảo An **3 sản phẩm**, trong đó `SP01` = "Áo sơ mi công sở", 200.000đ, kho 5; KB shop Linh 6 entries, Bảo An 3 entries; chạy lần 2 không nhân đôi (upsert).

- [ ] **Step 2: Viết `ids.ts` + `data.ts` + `base.ts` + `index.ts` cho test xanh**

Dữ liệu theo spec §9 (chép đúng bảng giá/kho/KB ghi trong spec; tên/chữ KB có thể diễn đạt tự nhiên nhưng phải gồm: Bảng size, Đổi trả 7 ngày, Hàng lỗi & bảo hành, Vận chuyển & phí, Cách chốt đơn qua live, Khuyến mãi freeship ≥300k giờ live). Shop Bảo An 3 SP: SP01 "Áo sơ mi công sở" 200.000/kho 5, SP02 "Quần âu công sở" 250.000/kho 4, SP03 "Thắt lưng da" 180.000/kho 6; KB: đổi trả 3 ngày, phí ship riêng, bảng size riêng. 5 tài khoản: `khach@demo.vn`, `hong@demo.vn`, `minh@demo.vn` (BUYER), `linh@demo.vn`, `baoan@demo.vn` (SELLER) — mật khẩu `demo123`. `index.ts` gọi `seedBase` (history ở Task 4).

- [ ] **Step 3: Chạy thật**

Run: `npm run seed` → không lỗi. Run: `npm test` → PASS.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: seed nền 2 shop + sản phẩm + KB + tài khoản demo (UUID cố định)"
```

---

### Task 4: Seed lịch sử (hội thoại đêm, phiên live cũ, đơn cũ)

**Files:**
- Create: `prisma/seed/history.ts`; `tests/seed-history.test.ts`.
- Modify: `prisma/seed/index.ts` (gọi thêm `seedHistory`).

**Interfaces:**
- Consumes: `SEED_IDS`, `seedBase` (Task 3).
- Produces: `seedHistory(prisma)` — upsert `Conversation` + `DirectMessage` + `LiveSession` (ENDED) + `Order` (PAID/CANCELLED/SHIPPED) có `paidAt`/`createdAt` lùi ngày cố định. Dùng cho badge “hội thoại trong đêm” và Dashboard (Plan 3).

- [ ] **Step 1: Viết test trước (đỏ)**

`tests/seed-history.test.ts`: sau `seedBase` + `seedHistory`; assert:
- **5 hội thoại** (khach↔Linh, Hồng↔Linh, Minh↔Linh, khach↔Bảo An, Hồng↔Bảo An), tin nhắn rải **7–30 ngày** trước, **≥2 hội thoại có tin AI trả lời trong khung 22h–6h**;
- 2 `LiveSession` ENDED (1 “hôm qua”, 1 “7 ngày trước”) thuộc shop Linh;
- 5 đơn lịch sử đúng bảng Step 2; tổng đơn **đã thu tiền** (`paidAt != null`) của shop Linh = **1.960.000đ**; có ≥1 đơn mỗi trạng thái PAID/SHIPPED/CANCELLED;
- chạy seed lần 2 (upsert) không nhân đôi.

- [ ] **Step 2: Viết `history.ts` cho test xanh**

IDs cố định trong `SEED_IDS.history.*`. Thời gian seed tính từ “hôm nay” (ví dụ `new Date(Date.now() - 1*day)`) nhưng **set giờ cụ thể** (phiên live hôm qua 20:00–22:05; nhóm đêm 23:10 / 00:12) để assert ổn định.

**Bảng đơn lịch sử cố định** (shop Linh; giá theo spec §9) — tổng đã thu tiền = 300.000 + 440.000 + 260.000 + 960.000 = **1.960.000đ**:

| Đơn | SP × qty | Tổng | Trạng thái | Thuộc phiên live |
|---|---|---|---|---|
| H1 | SP01 ×2 | 300.000 | PAID | hôm qua |
| H2 | SP02 ×2 | 440.000 | PAID | hôm qua |
| H3 | SP03 ×1 | 120.000 | CANCELLED | hôm qua |
| H4 | SP04 ×1 | 260.000 | SHIPPED | 7 ngày trước |
| H5 | SP06 ×3 | 960.000 | PAID | 7 ngày trước |

Buyer rải giữa 3 khách; `paidAt`/`createdAt` nằm trong khung giờ phiên live tương ứng; `eventId`/`paymentCode` cố định dạng `seed-h1` / `SEEDH1` (unique). Kho seed **không** bị trừ bởi đơn lịch sử (kho spec §9 là trạng thái hiện tại khi demo bắt đầu). Nội dung hội thoại viết tự nhiên quanh chủ đề mua sắm (size/đổi trả/đơn hàng) — sẽ là “nền” cho Plan 2.

- [ ] **Step 3: Chạy thật + commit**

Run: `npm run seed`; `npm test` → PASS.

```bash
git add -A
git commit -m "feat: seed lịch sử (hội thoại đêm, live cũ, đơn cũ)"
```

---

### Task 5: Auth core — ký/verify JWT (jose)

**Files:**
- Create: `lib/auth/constants.ts`; `lib/auth/token.ts`; `tests/auth-token.test.ts`.

**Interfaces:**
- Consumes: `JWT_SECRET` từ env.
- Produces (**dùng lại ở Task 6, 9, 10, 11**):
  - `COOKIE_NAME = 'liveorder_token'`
  - `type TokenPayload = { userId: string; role: 'BUYER' | 'SELLER'; name: string }`
  - `signToken(payload: TokenPayload): Promise<string>`
  - `verifyToken(token: string): Promise<TokenPayload | null>`

- [ ] **Step 1: Viết test trước (đỏ)** — `tests/auth-token.test.ts` (unit):

```ts
// 1) roundtrip: sign → verify trả đúng payload
// 2) token sửa 1 ký tự → verifyToken trả null
// 3) token hết hạn (sign với exp -1s qua helper test hoặc fake timers) → null
```

- [ ] **Step 2: Cài đặt cho xanh**

`lib/auth/token.ts` dùng `jose` HS256, `expiresIn: '7d'`; `verifyToken` bọc try/catch → `null` khi lỗi/hết hạn. `JWT_SECRET` đọc lúc gọi (không cache ở module scope để test đổi env được).

- [ ] **Step 3: Chạy test → PASS; commit**

```bash
git add -A
git commit -m "feat: auth core jwt (sign/verify) + tests"
```

---

### Task 6: Auth API + middleware + trang đăng nhập/đăng ký

**Files:**
- Create: `lib/auth/service.ts` (hàm thuần, nhận prisma); `lib/auth/guards.ts`; `app/api/auth/register/route.ts`; `app/api/auth/login/route.ts`; `app/api/auth/logout/route.ts`; `app/api/auth/demo-login/route.ts`; `app/api/auth/me/route.ts`; `middleware.ts`; `app/login/page.tsx`; `app/register/page.tsx`; `components/auth/AuthForm.tsx`; `tests/auth-service.test.ts`; `tests/auth-guards.test.ts`.

**Interfaces:**
- Consumes: `signToken`/`verifyToken`/`TokenPayload`/`COOKIE_NAME` (Task 5), `prisma` (Task 2).
- Produces (**dùng lại ở Task 11, 13**):
  - `registerUser(prisma, { email, password, name }): Promise<TokenPayload>` — role BUYER, hash bcryptjs (10 rounds), trùng email → throw `ApiError(409)`.
  - `login(prisma, { email, password }): Promise<TokenPayload>` — sai → `ApiError(401)`.
  - `demoLogin(prisma, as: 'buyer' | 'seller1' | 'seller2'): Promise<TokenPayload>` — chỉ khi `DEMO_MODE === 'true'`, ngược lại `ApiError(404)`; tra user seed theo email cố định.
  - `class ApiError extends Error { status: number }`
  - `requireUser(role?: 'BUYER' | 'SELLER'): Promise<TokenPayload>` — đọc cookie qua `cookies()`, verify, thiếu → 401, sai role → 403 (dùng trong route handlers).
  - Middleware bảo vệ: `/seller/*` (SELLER), `/inbox/*`, `/orders/*` (đăng nhập) — không đủ quyền → redirect `/login`.

- [ ] **Step 1: Viết test trước (đỏ)** — `tests/auth-service.test.ts` (integration, `resetDb`, `testPrisma`): đăng ký mới OK + hash ≠ plaintext; trùng email → 409; login đúng/sai mật khẩu; `demoLogin('seller1')` trả đúng user `linh@demo.vn` role SELLER; `demoLogin` khi `DEMO_MODE !== 'true'` → 404. `tests/auth-guards.test.ts`: `requireUser` với mock cookies (vi.mock `next/headers`) — nhưng đơn giản hơn: tách phần đọc token thành tham số `requireUserWithToken(token | undefined, role?)` (hàm thuần, test trực tiếp) và `requireUser` chỉ là wrapper mỏng lấy cookie. Test hàm thuần: thiếu token → 401, role lệch → 403, hợp lệ → payload.

- [ ] **Step 2: Cài đặt cho xanh** — theo Interfaces. Route handlers: try/catch `ApiError` → `NextResponse.json({ error }, { status })`; set cookie httpOnly `COOKIE_NAME` khi đăng nhập/đăng ký thành công (`path:'/'`, `sameSite:'lax'`, `maxAge 7d`; **không** `secure` khi dev local).

- [ ] **Step 3: Trang login/register + nút đăng nhập nhanh**

`/login`: form email/mật khẩu + 2 nút **👤 Khách demo** / **🏪 Shop demo** gọi `/api/auth/demo-login` (`buyer` / `seller1`) rồi `router.push('/')` hoặc `/seller/studio`. `/register`: form + validate cơ bản (email hợp lệ, mật khẩu ≥ 6). Trang hiển thị lỗi tiếng Việt.

- [ ] **Step 4: Kiểm tra thủ công**

Run `npm run dev`: đăng ký tài khoản mới → đăng nhập lại OK; nút demo-login OK; vào `/seller/studio` (chưa có trang → 404 của Next cũng chấp nhận ở bước này, nhưng middleware phải redirect `/login` khi chưa đăng nhập — kiểm tra bằng cửa sổ ẩn danh). `npm test` PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: auth api + middleware + trang login/register + đăng nhập nhanh demo"
```

---

### Task 7: Module che SĐT (server-side)

**Files:**
- Create: `lib/mask.ts`; `tests/mask.test.ts`.

**Interfaces:**
- Consumes: không.
- Produces (dùng ở Task 9): `maskPhones(text: string): string` — trả về text với mọi số điện thoại VN dạng di động bị thay bằng `0xxx***xxx` (4 số đầu + `***` + 3 số cuối).

- [ ] **Step 1: Viết test trước (đỏ)** — `tests/mask.test.ts` (unit), đúng các ca:

```ts
expect(maskPhones('gọi 0912345678 nhé')).toBe('gọi 0912***678 nhé')
expect(maskPhones('sđt: 0912 345 678')).toBe('sđt: 0912***678')
expect(maskPhones('+84912345678 ship nhé')).toBe('0912***678 ship nhé')
expect(maskPhones('0912.345.678 và 0987654321')).toBe('0912***678 và 0987***321')
expect(maskPhones('giá 1500000đ')).toBe('giá 1500000đ') // không phải SĐT → giữ nguyên
```

- [ ] **Step 2: Cài đặt cho xanh** — chuẩn hóa ứng viên (bỏ dấu cách/chấm/gạch, quy `+84`→`0`), nhận diện đầu số di động VN (`03|05|07|08|09` + 8 chữ số), mask theo chuẩn hóa. Có ranh giới số (không cắt vào chuỗi số dài hơn).

- [ ] **Step 3: Chạy test → PASS; commit**

```bash
git add -A
git commit -m "feat: module che SĐT server-side + tests biến thể"
```

---

### Task 8: Thuật toán Aho-Corasick (word-boundary, có đo thời gian)

**Files:**
- Create: `lib/aho-corasick.ts`; `tests/aho-corasick.test.ts`.

**Interfaces:**
- Consumes: không.
- Produces (dùng ở Task 9, 13):
  - `type Match = { sku: string; start: number; end: number }` (`start`/`end` là vị trí trong chuỗi đã đưa vào tìm — dùng để highlight).
  - `buildAutomaton(skus: string[]): Automaton`
  - `findMatches(automaton: Automaton, text: string): Match[]`
  - `findMatchesWithTiming(automaton: Automaton, text: string): { matches: Match[]; elapsedMs: number }` — `elapsedMs` đo bằng `performance.now()`, **số thật**.

- [ ] **Step 1: Viết test trước (đỏ)** — `tests/aho-corasick.test.ts` (unit):

```ts
// Cơ bản: 'mình lấy SP01 2 cái' → 1 match { sku:'SP01', start:9, end:13 }
// Ranh giới từ: text 'SP010 size L' với patterns [SP01, SP010] → chỉ match SP010
//              text 'xSP01' → không match SP01   (ký tự trước là chữ)
// Hoa thường: 'sp01 còn không' → match SP01 (so không phân biệt hoa/thường)
// Nhiều match: 'SP01 và SP03' → 2 matches đúng thứ tự, đúng vị trí
// Unicode xung quanh: 'áo đẹp quá SP02 nha' → vị trí đúng theo index UTF-16
// Danh sách rỗng / text rỗng → []
// elapsedMs là số ≥ 0 và là số thực (không hard-code)
```

- [ ] **Step 2: Cài đặt cho xanh** — trie + failure links kinh điển; so khớp trên bản chữ hoa **từng code unit** (`char.toUpperCase()` từng ký tự — giữ đúng index UTF-16 kể cả khi casing đổi độ dài, vd `ß`; hành vi y hệt `toUpperCase()` cả chuỗi với ASCII/tiếng Việt — R15). Kiểm tra ranh giới: ký tự trước `start` và sau `end` không thuộc `[A-Z0-9_]` (không phân biệt hoa thường). Một vị trí bắt đầu chỉ trả match dài nhất (để SP010 thắng SP01).

- [ ] **Step 3: Chạy test → PASS; commit**

```bash
git add -A
git commit -m "feat: aho-corasick word-boundary + đo thời gian thật + tests"
```

---

### Task 9: Live service — pipeline comment → bắt SKU → tạo đơn + trừ kho nguyên tử

**Files:**
- Create: `lib/live/service.ts`; `tests/live-service.test.ts`.

**Interfaces:**
- Consumes: `maskPhones` (Task 7), `buildAutomaton`/`findMatchesWithTiming`/`Match` (Task 8), schema (Task 2).
- Produces (dùng ở Task 10, 11):

```ts
export type OrderSummary = { id: string; code: number; sku: string; productName: string; qty: number; total: number; status: OrderStatus }
export type ProcessCommentInput = { sessionId: string; user: { userId: string; name: string; role: 'BUYER' | 'SELLER' }; rawText: string; clientNonce?: string } // user chính là TokenPayload (Task 5) — khớp trực tiếp với socket.data.user
export type ProcessCommentResult =
  | { ok: true; text: string; matches: Match[]; elapsedMs: number; order?: OrderSummary; duplicate?: true; outOfStockSku?: string }
  | { ok: false; reason: 'NO_LIVE_SESSION' | 'EMPTY_TEXT' }
export async function processComment(prisma: PrismaClient, input: ProcessCommentInput): Promise<ProcessCommentResult>
```

Quy tắc cố định:
- Pipeline: `maskPhones(rawText)` → parse trên **chuỗi đã che** (để `start/end` khớp đúng text phát đi) → nếu có match, lấy match **đầu tiên**.
- Số lượng: trong **20 ký tự sau** match, tìm **số đứng riêng** 1–2 chữ số đầu tiên (regex `(?<![\dA-Za-z_])(\d{1,2})(?![\dA-Za-z_])` — R16: biên giới nhận cả chữ/underscore để “02” trong `SP02` không bị đếm) → qty (clamp 1..99); không có → 1. (Số nằm TRƯỚC mã không tính; “SP02 mình lấy 2 nha” → 2.)
- `eventId = sha1(`${sessionId}|${user.userId}|${clientNonce ?? randomUUID()}|${sku}`)` — cùng nonce gửi lại ⇒ cùng eventId ⇒ trả lại đơn cũ với `duplicate: true`, **không trừ kho lần 2**.
- Tạo đơn trong `prisma.$transaction`: `updateMany({ where: { id: productId, stock: { gte: qty } }, data: { stock: { decrement: qty } } })` → count 0 ⇒ **hết hàng** (`outOfStockSku`, không tạo đơn, kho nguyên); count 1 ⇒ tạo `Order` (unitPrice = product.price, total, `paymentCode` `PAY` + base36 ngẫu nhiên 8 ký tự, `liveSessionId`, status PENDING).
- Session không `LIVE` → `{ ok: false, reason: 'NO_LIVE_SESSION' }`. Text trắng → `'EMPTY_TEXT'`.

- [ ] **Step 1: Viết test trước (đỏ)** — `tests/live-service.test.ts` (integration, `resetDb`, seed nền qua `seedBase`):

```ts
// (a) 'SP01 2 cái' khi kho 8 → ok, order.code>0, qty 2, total 300000, kho còn 6
// (b) text không có SKU ('áo đẹp quá') → ok, không order, matches []
// (c) SĐT trước SKU: '0912 345 678 SP01 1 cái' → text bị che, và masked.slice(m.start, m.end) === 'SP01' (vị trí đúng trên chuỗi đã che)
// (d) cùng nonce gửi 2 lần → lần 2 duplicate:true, cùng order.id, kho chỉ giảm 1 lần
// (e) kho = 1, 2 khách Promise.all cùng chốt → đúng 1 ok có order + 1 outOfStockSku, kho cuối = 0
// (f) session ENDED → { ok:false, reason:'NO_LIVE_SESSION' }
// (g) qty: 'SP02 mình lấy 2 nha' → 2 (số cách 11 ký tự — nằm trong ngưỡng 20); 'SP02 nha' → 1; 'SP011' → không match (ranh giới từ)
```

- [ ] **Step 2: Cài đặt cho xanh** — theo Interfaces + quy tắc trên. Bắt lỗi unique `eventId` (P2002) → truy vấn lại đơn cũ trả `duplicate: true`.

- [ ] **Step 3: Chạy test → PASS; commit**

```bash
git add -A
git commit -m "feat: pipeline comment → đơn + trừ kho atomic (eventId chống trùng)"
```

---

### Task 10: Socket gateway `/live` + custom server

**Files:**
- Create: `server.ts`; `lib/live/gateway.ts`; `lib/socket-registry.ts`; `lib/live/fake-comments.ts`; `tests/live-gateway.test.ts`.
- Modify: `package.json` (scripts `dev`: `tsx server.ts`, `build`: `next build`, `start`: `cross-env NODE_ENV=production tsx server.ts`).

**Interfaces:**
- Consumes: `verifyToken` (Task 5), `processComment` (Task 9), `prisma` (Task 2).
- Produces (dùng ở Task 12–14):
  - `setIo(io)` / `getIo(): Server | null` từ `lib/socket-registry.ts` — để route handlers phát sự kiện khi cùng process.
  - `attachLiveGateway(io: Server, prisma: PrismaClient): void` — namespace `/live`; handshake auth `socket.handshake.auth.token` qua `verifyToken` (sai/thiếu → `next(new Error('unauthorized'))`).
  - Sự kiện client→server: `join_live { sessionId }` (session không tồn tại/không LIVE → phát `live_ended { sessionId }` riêng cho client đó, không join; hợp lệ → join room `live:{sessionId}`); `send_comment { sessionId, text, nonce? }` — gọi `processComment(prisma, { sessionId, user: socket.data.user, rawText: text, clientNonce: nonce })`; **danh tính chỉ lấy từ `socket.data.user`**, bỏ qua mọi field danh tính trong payload.
  - Sự kiện server→room: `comment { userId, userName, text, matches, kind: 'user' | 'system', elapsedMs?, createdAt }`; `new_order { order: OrderSummary, buyerId, buyerName }`; `viewers { count }`; `live_started { session: { id; title; shopName } }` (phát từ REST Task 11 tới cả namespace); `live_ended { sessionId }`.
  - Seller-only (role SELLER): không thêm ở đây — start/end qua REST (Task 11) để 1 nguồn sự thật.
  - `startFakeComments(io, sessionId, shopName)` / `stopFakeComments(sessionId)` / `getFakeCommentPeak(sessionId): number` / `isFakeCommentsRunning(sessionId): boolean` — chỉ chạy khi `DEMO_MODE==='true'`; `start` **idempotent** (gọi lại khi đang chạy thì không nhân đôi interval); đẩy comment mẫu tiếng Việt mỗi 4–8s + tăng/giảm `viewers` (số trong RAM, lưu `peakViewers` khi end ở Task 11); `isFakeCommentsRunning` là helper cho test (Task 10 test 7) và nút UI.
  - Sự kiện seller-only `toggle_fake { sessionId, enabled }` — kiểm tra session thuộc shop của seller (theo JWT) rồi start/stop giả lập; sai quyền → bỏ qua, không phát gì.

- [ ] **Step 1: Viết test trước (đỏ)** — `tests/live-gateway.test.ts` (integration): dựng `http.createServer` + `new Server` socket.io cổng ngẫu nhiên + `attachLiveGateway(io, testPrisma)`; seed nền + tạo 1 LiveSession LIVE; client `socket.io-client` với token thật:

```ts
// (1) không token → connect_error 'unauthorized'
// (2) buyer A join_live + send_comment('SP01 1 cái') → nhận 'comment' (có text, matches)
//     và order trong DB có buyerId = A
// (3) GIẢ MẠO: payload gửi kèm { buyerId: B, userId: B, role:'SELLER' } → đơn vẫn thuộc A,
//     comment event userId = A
// (4) comment chứa SĐT → text phát đi đã che (nhận trong event 'comment')
// (5) cùng nonce 2 lần → chỉ 1 order trong DB; new_order phát đúng 1 lần (lần 2 duplicate chỉ phát comment)
// (6) client kết nối (có token) nhưng không join_live → không nhận comment nào
// (7) trạng thái giả lập quan sát qua isFakeCommentsRunning: seller bật toggle_fake → true; buyer gửi toggle_fake (enabled=false) → giữ nguyên true; seller tắt → false
```

- [ ] **Step 2: Cài đặt cho xanh** — theo Interfaces. `server.ts`: pattern custom server Next (`next({ dev })`, `app.prepare()`, `getRequestHandler()`), gắn `io` + `setIo(io)`, listen `PORT`. Trong `send_comment`: gọi `processComment`, phát `comment` (mask rồi), nếu `order && !duplicate` phát `new_order`, nếu `outOfStockSku` phát `comment` `kind:'system'` với text “SP01 đã hết hàng”. Lỗi validation (text > 200 ký tự, thiếu sessionId) → event `error_msg` hoặc bỏ qua im lặng — pin: phát `comment` system “Tin nhắn không hợp lệ”.

- [ ] **Step 3: Chạy test → PASS**

- [ ] **Step 4: Kiểm tra thủ công custom server**

Run `npm run dev` → trang chủ load qua `server.ts` (3000), log hiện socket server sẵn sàng. `npm run build` PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: socket gateway /live (identity từ JWT, che SĐT) + custom server"
```

---

### Task 11: API phiên live (start/end/active) + guard seller

**Files:**
- Create: `lib/live/sessions.ts`; `app/api/seller/live/start/route.ts`; `app/api/seller/live/end/route.ts`; `app/api/live/active/route.ts`; `tests/live-sessions.test.ts`.

**Interfaces:**
- Consumes: `requireUser` (Task 6), `getIo` (Task 10), `startFakeComments`/`stopFakeComments` (Task 10).
- Produces (dùng ở Task 12–14):

```ts
export async function startLive(prisma, shopId: string, title: string): Promise<LiveSession>
//  - shop đang có session LIVE → ApiError(409, 'Shop đang có live khác')
export async function endLive(prisma, sessionId: string): Promise<{ session: LiveSession; summary: { orderCount: number; paidRevenue: number } }>
//  - summary: đếm Order có liveSessionId=session; paidRevenue = tổng total các đơn có paidAt != null (PAID/SHIPPED) của session
export async function getActiveLive(prisma): Promise<Array<{ session: LiveSession; shop: Shop }>>
```

Routes: `POST /api/seller/live/start {title}` (SELLER; lấy shop theo `requireUser`; sau khi tạo → `getIo()?.of('/live')` phát `live_started` toàn namespace + `startFakeComments` khi `DEMO_MODE`); `POST /api/seller/live/end` (SELLER, chỉ kết thúc session của shop mình → cập nhật `status ENDED`, `endedAt now`, lưu `peakViewers = getFakeCommentPeak(sessionId)`; phát `live_ended`; `stopFakeComments`); `GET /api/live/active` (public: danh sách live đang mở + shop — dùng cho Trang chủ & Studio).

- [ ] **Step 1: Viết test trước (đỏ)** — `tests/live-sessions.test.ts` (integration): start OK; start lần 2 khi đang LIVE → 409; end trả summary đúng với đơn đã tạo trong session (tạo 1 đơn PAID + 1 PENDING bằng seed trực tiếp → orderCount 2, paidRevenue = tổng PAID); end session của shop khác (seller token shop 2) → 403/404 pin: **404** (“không tìm thấy phiên của shop bạn”).

- [ ] **Step 2: Cài đặt cho xanh** — theo Interfaces. Guard: `requireUser('SELLER')` + tra shop theo ownerId.

- [ ] **Step 3: Chạy test PASS; kiểm tra nhanh bằng curl sau khi `npm run dev`** (start/end/active với cookie demo-login lấy qua `curl -c`), rồi commit

```bash
git add -A
git commit -m "feat: api phiên live start/end/active + guard seller"
```

---

### Task 12: Trang chủ — danh sách shop (live trước, offline sau)

**Files:**
- Modify: `app/page.tsx` (server component).
- Create: `components/home/ShopCard.tsx`.

**Interfaces:**
- Consumes: `prisma`, `getActiveLive` (Task 11), shop + session data (Task 3–4).
- Produces: Trang chủ hiển thị shop đang live lên đầu (badge `● LIVE`, tiêu đề live, nút **Xem live** → `/live/{sessionId}`); shop offline bên dưới (badge “Đang offline”; **chưa** có nút Nhắn tin — Plan 2 thêm theo quyết định B4).

- [ ] **Step 1: Dựng UI** — server component query trực tiếp qua `prisma` (không qua REST), render tiếng Việt, Tailwind sạch sẽ. Không cần test tự động; kiểm tra thủ công.
- [ ] **Step 2: Kiểm tra thủ công** — `npm run dev`: chạy `npm run seed`, mở `/` thấy 2 shop; chạy `POST /api/seller/live/start` (qua UI studio ở task sau hoặc curl) → shop lên đầu với badge LIVE.
- [ ] **Step 3: Commit** `git commit -m "feat: trang chủ danh sách shop (live ưu tiên)"`

---

### Task 13: Studio seller — webcam, feed comment, panel đơn nổ, dải log, kết thúc live

**Files:**
- Create: `app/seller/studio/page.tsx` (server component đọc cookie → truyền `token` xuống client); `components/studio/StudioClient.tsx`; `components/studio/WebcamPreview.tsx`; `components/studio/LiveCommentFeed.tsx`; `components/studio/LiveOrderPanel.tsx`; `components/studio/EngineLogStrip.tsx`; `components/studio/EndLiveDialog.tsx`; `hooks/useLiveSocket.ts`.
- Create placeholder: `app/inbox/page.tsx` (nêu rõ “Inbox AI — sẽ hoàn thiện ở Plan 2”).

**Interfaces:**
- Consumes: REST start/end (Task 11), socket events (Task 10), `getIo` broadcast.
- Produces: hook `useLiveSocket(token: string, sessionId: string | null)` — kết nối `/live` với `auth: { token }`, tham gia `join_live`, trả `{ comments, orders, viewers, ended, connected }` (comment: có `matches`, `kind`, `elapsedMs`; `ended` = true khi nhận `live_ended` — kể cả trường hợp server báo session không LIVE lúc join).

Hành vi cố định:
- Webcam: `navigator.mediaDevices.getUserMedia({ video: true })` → `<video muted autoPlay>`; lỗi quyền → khối hướng dẫn thay thế (không chặn UI).
- Tiêu đề live + nút **■ Kết thúc live** → gọi end → `EndLiveDialog` hiện tổng kết (`orderCount`, `paidRevenue` từ response) + nút “Xem Dashboard chi tiết” (link `/seller` — Plan 3 mới có; hiện disable kèm chú thích).
- Feed comment: hiển thị `userName: text` với **highlight các `matches`** (màu vàng như mockup) + dòng hệ thống xanh `⚡ Bắt SKU {ms} ms → tạo Đơn #{code}` khi có order; comment `kind:'system'` hiện màu cảnh báo.
- Panel **Đơn nổ realtime**: nhận `new_order` → thẻ mới viền accent, logo “vừa xong”; danh sách cập nhật không reload.
- `EngineLogStrip`: hiển thị `⚙️ Aho-Corasick theo dõi N mã SKU` (N = số sản phẩm shop) + log gần nhất `⏱ x,x ms` (số thật từ event) + nhãn `🔍 Kỹ thuật · bật`.
- Nút **🎭 Giả lập khách** (chỉ `DEMO_MODE`): bật/tắt → emit `toggle_fake { sessionId, enabled }`; mặc định **bật** khi bắt đầu live; trạng thái hiện trên nút.
- Bắt đầu live: form tiêu đề + nút “Bắt đầu live” khi shop chưa LIVE.

- [ ] **Step 1: Dựng các component + hook theo Interfaces.**
- [ ] **Step 2: Kiểm tra thủ công (2 cửa sổ: 1 thường seller, 1 ẩn danh chuẩn bị cho task sau):** đăng nhập seller → bắt đầu live → webcam hiện (hoặc hướng dẫn quyền) → comment mẫu tự chảy (DEMO_MODE, thử tắt/bật bằng nút 🎭) → dừng live → dialog tổng kết đúng số lượng đơn. `npm run build` PASS.
- [ ] **Step 3: Commit** `git commit -m "feat: studio seller (webcam, feed, đơn nổ, log, end-live)"`

---

### Task 14: Màn xem live kiểu TikTok (buyer) — highlight, toast, đơn của tôi

**Files:**
- Create: `app/live/[id]/page.tsx` (server component: load session + shop **trực tiếp qua `prisma`**, đọc cookie → truyền `token`, `userId`, `userName` xuống client); `components/live/ViewerClient.tsx`; `components/live/ChatOverlay.tsx`; `components/live/CommentInput.tsx`; `components/live/OrderToast.tsx`; `components/live/MyOrderCard.tsx`; `components/live/ConsultButton.tsx`.

**Interfaces:**
- Consumes: `useLiveSocket` (Task 13), socket events (Task 10), `matchPhones` đã áp phía server (client chỉ render text nhận được + `matches` để highlight).
- Produces: hành vi viewer theo mockup đã duyệt (spec §5.2):
  - Nền “video”: khối 16:9 nền tối có tên shop + badge `● LIVE · 👀 {viewers}` + ghi chú “(video minh họa)”; thử `<video>` file mẫu nếu có `public/demo-video.mp4`, không có thì placeholder.
  - Chat overlay nền tối phía dưới-trái (kiểu TikTok — quyết định #2): bong bóng `Tên: nội dung`, highlight SKU bằng nền vàng chữ đậm, dòng hệ thống xanh.
  - Ô nhập dưới cùng: gửi `send_comment { sessionId, text, nonce: crypto.randomUUID() }`; nút Gửi disable tới khi có phản hồi/timeout 3s (chống double-click).
  - `OrderToast`: khi `new_order.buyerId === userId` → toast `✅ Chốt đơn #{code} — {sku} ×{qty} · {total}đ`.
  - `MyOrderCard`: danh sách đơn của mình trong session này (nhận từ `new_order` khi khớp `userId`) + link “Xem đơn & QR →” (`/orders` — Plan 3; tạm disable).
  - `ConsultButton` (góc trên phải): `💬 Tư vấn` → `/inbox?shopId=...` (placeholder Plan 2 tồn tại ở Task 13).
  - Session `ENDED`: hiện banner “Live đã kết thúc”.

- [ ] **Step 1: Dựng UI theo Interfaces.**
- [ ] **Step 2: Kiểm tra thủ công (kịch bản 2 cửa sổ — spec §10 bước 1–2):** cửa sổ A đăng nhập nhanh Shop → bắt đầu live; cửa sổ B (ẩn danh) đăng nhập nhanh Khách → vào live → gõ `SP01 2 cái` → cả 2 cửa sổ thấy highlight + dòng `⚡ … ms`; B thấy toast + MyOrderCard; comment SĐT hiện đã che; `npm run build` PASS.
- [ ] **Step 3: Commit** `git commit -m "feat: màn xem live TikTok-style (highlight, toast, đơn của tôi)"`

---

### Task 15: Chốt Plan 1 — README, kiểm tra tổng, kịch bản smoke

**Files:**
- Modify: `README.md` (đầy đủ: cách chạy `docker compose up -d` → copy `.env` → `npx prisma migrate dev` → `npm run seed` → `npm run dev`; tài khoản demo; luồng 2 cửa sổ; lưu ý DEMO_MODE/Groq để trống cho Plan 2; version Next thực tế); `.env.example` rà lại khớp.

- [ ] **Step 1: Chạy toàn bộ kiểm tra:** `npm test` (PASS hết), `npm run build` (PASS), `npm run lint` (PASS).
- [ ] **Step 2: Chạy kịch bản smoke thủ công (2 cửa sổ)** theo Task 14 Step 2 + phụ: kết thúc live → dialog tổng kết khớp số đơn thật; mở lại `/` thấy shop về trạng thái offline.
- [ ] **Step 3: Nghiệm thu nhanh theo spec §12 (các mục thuộc phạm vi Plan 1):** comment chốt đơn ✓ highlight+ms ✓ kho atomic (test) ✓ SĐT che ✓ chống trùng nonce (test) ✓ identity từ JWT (test) ✓ tiếp quản/AI: **không thuộc Plan 1**.
- [ ] **Step 4: Commit** `git commit -m "docs: README quickstart + chốt Plan 1"`.

---

## Ghi chú cho người thực thi

- Thứ tự task là dây phụ thuộc; đừng nhảy cóc phần DB (Task 2–4) trước khi làm service.
- Integration test luôn chạy trên `TEST_DATABASE_URL`; **không bao giờ** trỏ test vào DB dev.
- Mọi chỗ hiển thị “ms” cho người dùng cuối phải lấy từ `elapsedMs` thật — cấm hard-code.
- Khi plan này xong, **báo người dùng** để (a) duyệt Plan 2 (AI/RAG — sẽ viết sau khi có kết quả embedding spike) và (b) quyết định thứ tự M3/M4 trong Plan 3.
