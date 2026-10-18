# LiveOrder — demo livestream bán hàng

Ứng dụng demo bán hàng qua livestream (đồ án tốt nghiệp): người bán lên sóng bằng webcam, người mua xem và **chốt đơn ngay trong bình luận** (`SP01 2 cái` → hệ thống bắt mã bằng Aho-Corasick, trừ kho nguyên tử, tạo đơn realtime). Toàn bộ chạy trên một process Next.js + socket.io tự viết.

> Trạng thái: **Plan 1 (lõi livestream) đã hoàn tất** — xem mục [Trạng thái dự án](#11-trạng-thái-dự-án).

## 1. Yêu cầu

- **Node.js 20+** và npm.
- **Docker** (Docker Desktop trên Windows/macOS) — PostgreSQL chạy trong container.
- **Windows:** các lệnh bên dưới viết theo Git Bash; PowerShell dùng lệnh tương đương (xem chú thích). Nếu PowerShell chặn `npm`/`npx` (execution policy), dùng `npm.cmd` / `npx.cmd`.

## 2. Quickstart (6 bước)

```bash
# 1) Cài dependencies — postinstall tự chạy `prisma generate`
npm install

# 2) Tạo file .env từ mẫu rồi mở chỉnh (đổi JWT_SECRET trước khi demo thật)
cp .env.example .env          # Git Bash / macOS / Linux

# 3) Dựng PostgreSQL 16 (Docker)
docker compose up -d          # container lắng nghe tại localhost:5433

# 4) Tạo schema DB dev + nạp dữ liệu demo (idempotent)
npx prisma migrate dev
npm run seed

# 5) Chạy app (Next.js + socket.io trong CÙNG một process)
npm run dev

# 6) Mở http://localhost:3000
```

> Trên **PowerShell**, thay bước 2 bằng `Copy-Item .env.example .env`.

Sau bước 6: đăng nhập bằng tài khoản demo (mục 6) hoặc bấm nút **đăng nhập nhanh** ở `/login` khi `DEMO_MODE=true`.

## 3. Ghi chú port & Docker

- PostgreSQL map **`5433:5432`** (ruling R12): port 5432 thường đã bị project khác chiếm, nên compose phơi ra ngoài ở **5433**. `DATABASE_URL`/`TEST_DATABASE_URL` trong `.env` đã trỏ sẵn `localhost:5433` — đổi cả compose lẫn `.env` nếu muốn port khác.
- Một container phục vụ **2 database**: `liveorder` (dev) và `liveorder_test` (test, do `tests/global-setup.ts` tự `prisma migrate deploy` trước khi chạy test).
- **Tên container thay đổi theo tên thư mục** (docker compose lấy tên thư mục làm project name). Trong repo này: `docker ps` → `plan1-live-core-db-1`. Vào DB bằng:
  ```bash
  docker exec -it plan1-live-core-db-1 psql -U liveorder -d liveorder
  ```
- Dừng / xoá dữ liệu: `docker compose down` (giữ dữ liệu) hoặc `docker compose down -v` (xoá sạch volume).

## 4. Scripts

| Lệnh | Việc |
| --- | --- |
| `npm run dev` | Chạy custom server `tsx server.ts` — Next dev + socket.io namespace `/live` cùng process, port `PORT` (mặc định 3000). |
| `npm run start` | Bản production của custom server (`NODE_ENV=production tsx server.ts`). Chạy `npm run build` trước. **KHÔNG dùng `next start`** — `next start` không gắn socket.io nên comment/đơn sẽ không realtime. |
| `npm run build` | Build production (`next build`). |
| `npm run lint` | ESLint toàn repo. |
| `npm test` | Vitest (một lượt). **Cần Docker**: global-setup tự migrate `TEST_DATABASE_URL` (`liveorder_test`) trước khi chạy. |
| `npm run test:watch` | Vitest watch mode. |
| `npm run seed` | Nạp/khôi phục dữ liệu demo (upsert theo id cố định — chạy lại không nhân đôi; lưu ý chạy lại sẽ **đưa giá/kho sản phẩm về đúng chuẩn seed**, không xoá đơn cũ). |

## 5. Biến môi trường

Copy từ `.env.example` → `.env` (file `.env` đã bị gitignore, **không commit**):

| Biến | Ý nghĩa |
| --- | --- |
| `DATABASE_URL` | `postgresql://liveorder:liveorder@localhost:5433/liveorder` — DB dev. |
| `TEST_DATABASE_URL` | `...:5433/liveorder_test` — DB test cho `npm test`. Bắt buộc phải khác `DATABASE_URL` (global-setup chặn nếu trùng). |
| `JWT_SECRET` | Khoá ký JWT phiên đăng nhập — **đổi trước khi demo thật**. |
| `DEMO_MODE` | `true`: bật đăng nhập nhanh + suối comment giả lập + số người xem ảo. `false`: `POST /api/auth/demo-login` trả 404 và giả lập khách không chạy. |
| `GROQ_API_KEY` | **Để trống ở Plan 1** — AI/RAG (Groq) thuộc Plan 2, chưa có trong mã nguồn. |
| `PORT` | Port app (mặc định `3000`). |

## 6. Tài khoản demo

Mật khẩu chung cho **mọi** tài khoản: `demo123` (dữ liệu do `npm run seed` tạo).

| Email | Tên | Vai trò | Shop |
| --- | --- | --- | --- |
| `khach@demo.vn` | Khách | người mua | — |
| `hong@demo.vn` | Hồng | người mua | — |
| `minh@demo.vn` | Minh Tú | người mua | — |
| `linh@demo.vn` | Linh | người bán | Shop Thời Trang Linh |
| `baoan@demo.vn` | Bảo An | người bán | Shop Áo Sơ Mi Bảo An |

Khi `DEMO_MODE=true`, trang `/login` có khối **Đăng nhập nhanh (demo)**:

- **👤 Khách demo** → đăng nhập `khach@demo.vn`, về Trang chủ `/`.
- **🏪 Shop demo** → đăng nhập `linh@demo.vn`, vào thẳng `/seller/studio`.
- `baoan@demo.vn` (shop 2 — dùng cho kịch bản chống lẫn shop) đăng nhập bằng form thường, hoặc gọi `POST /api/auth/demo-login` với `{"as":"buyer" | "seller1" | "seller2"}`.

## 7. Kịch bản demo "2 cửa sổ" (8 bước)

Cần 2 cửa sổ: một **thường** cho shop, một **ẩn danh (incognito)** cho khách — cookie phiên dùng chung cho mọi tab cùng profile, nên bắt buộc mở ẩn danh.

1. **Cửa sổ thường** — mở `/login` → bấm **🏪 Shop demo** → vào `/seller/studio`.
2. Nhập **tiêu đề live** (bắt buộc) → bấm **Bắt đầu phiên live** (webcam preview hiện và xin quyền tại bước này). Khung chat bắt đầu có comment mẫu + số 👀 (do `DEMO_MODE`).
3. **Cửa sổ ẩn danh** — mở `/login` → bấm **👤 Khách demo** → về Trang chủ `/` → thẻ shop hiện ảnh live → bấm **Xem live →** (vào `/live/{id}`).
4. Khách gõ `SP01 2 cái` vào ô **Bình luận trong live** → **Gửi**.
5. Quan sát cả 2 phía:
   - Shop: đơn mới trong **🧾 Đơn nổ realtime** + dòng log `⚙️ … bắt "SP01" → Đơn #X · 0,x ms` (số ms **thật**, không hard-code).
   - Khách: `SP01` được highlight trong feed, dòng `⚡ … Đơn #X · ⏱ 0,x ms`, toast đơn nổ + thẻ **📦 Đơn của bạn**.
6. (Tuỳ chọn) Bấm **🎭 Giả lập khách** ở Studio để bật/tắt suối comment mẫu + số người xem ảo.
7. Shop bấm **■ Kết thúc live** → dialog **"Live đã kết thúc"** với **Đơn đã chốt** và **Doanh thu đã thu** (chỉ tính đơn đã thanh toán trong phiên).
8. Mở lại `/` ở cửa sổ khách → shop về trạng thái offline: hết badge live, hiện copy *"Khi shop lên sóng, thẻ sẽ hiện nút Xem live ngay tại đây."*

> Nút **Xem Dashboard chi tiết** trong dialog kết thúc bị mờ có chủ đích (kèm nhãn "Plan 3") — Dashboard thuộc **Plan 3**.

## 8. Cú pháp chốt đơn trong live

- Gõ **mã SKU** + **số lượng viết rời** phía sau, ví dụ: `SP01 2 cái`, `SP03 3 chiếc`, `lấy SP02 1`.
- **Số lượng** (tuỳ chọn): số **1–2 chữ số đứng rời** trong vòng 20 ký tự sau mã — `SP01 2 cái` → 2. Viết dính (`x2`, `SP012`) hoặc số từ 3 chữ số trở lên → hiểu là **1** (`SP01 100 cái` → 1); không ghi số cũng là 1.
- Mã sản phẩm: **Shop Thời Trang Linh: `SP01`–`SP07`**; **Shop Áo Sơ Mi Bảo An: `SP01`–`SP03`** (mỗi shop một bảng giá/kho riêng — `SP01` của hai shop là hai sản phẩm khác nhau).
- Mỗi bình luận **chốt một đơn cho mã ĐẦU TIÊN khớp**. Có thể nhắc nhiều mã trong cùng bình luận — tất cả đều được highlight, nhưng chỉ mã đầu tạo đơn; muốn chốt nhiều mã thì gõ từng bình luận.
- Bình luận chứa **số điện thoại được che tự động** trước khi hiển thị (ví dụ `0912***678`).
- **Hết kho**: hệ thống phát dòng `"SPxx đã hết hàng"`, không tạo đơn, kho không bao giờ âm (hai khách cùng chốt khi kho còn 1 → đúng 1 người thắng).
- **Chống trùng**: double-click / gửi lặp do mạng lag không tạo đơn trùng.

## 9. Ghi chú version

- **Next.js 16.4.2** (App Router; plan gốc ghi 15 — deviation đã được chấp nhận), **React 19.3**, **Tailwind CSS v4**, **Prisma 7** (Prisma Client sinh vào `generated/prisma`, cấu hình URL nằm ở `prisma.config.ts`), socket.io 4.
- Next 16 đổi `middleware.ts` → **`proxy.ts`** (chặn `/seller/*`, `/inbox/*`, `/orders/*` khi chưa đủ quyền).
- Next 16 + Cache Components: các trang đọc cookie/DB (`/`, `/live/[id]`, `/seller/studio`) render theo từng request — trạng thái live đổi là HTML đổi ngay.
- `npm run dev` / `npm run start` dùng **custom server `tsx server.ts`**; đừng thay bằng `next dev`/`next start` (mất socket.io).

## 10. Xử lý sự cố nhanh

| Triệu chứng | Cách xử lý |
| --- | --- |
| `docker compose up -d` báo port 5433 bận | Tắt container/project khác đang giữ 5433 (`docker ps`), hoặc đổi map port trong `docker-compose.yml` **và** `DATABASE_URL`/`TEST_DATABASE_URL` cho khớp. |
| `npm test` báo `TEST_DATABASE_URL is not set` | Chưa có `.env` — copy từ `.env.example`. |
| `npm test` lỗi kết nối / migrate vào `liveorder_test` | Docker chưa chạy hoặc container chưa lên: `docker compose up -d` rồi chạy lại. |
| Camera không mở ở Studio | Webcam chỉ chạy ở `http://localhost` hoặc HTTPS (không chạy qua IP LAN `http://`), cần cấp quyền camera cho trình duyệt và không để app khác giữ webcam. |
| `npm run seed` báo lỗi unique | Dữ liệu cũ lệch id: `npx prisma migrate reset` (xoá sạch DB dev) rồi `npm run seed`. |
| Lỗi import `generated/prisma` sau khi clone | `npx prisma generate` (thường đã tự chạy ở `npm install`). |
| Port 3000 bận | Đổi `PORT` trong `.env` và mở lại đúng port mới. |
| Muốn reset dữ liệu demo | `npx prisma migrate reset` (xoá toàn bộ) + `npm run seed`; hoặc chỉ `npm run seed` để khôi phục giá/kho về chuẩn (đơn cũ vẫn giữ). |

## 11. Trạng thái dự án

- **Plan 1 — Lõi livestream (T1–T15): ✅ hoàn tất.** Auth + seed 2 shop; custom server + socket `/live` xác thực JWT; Aho-Corasick bắt SKU + highlight + đo `ms` thật; tạo đơn & trừ kho nguyên tử; chống trùng nonce; che SĐT; Studio webcam + log engine + đơn nổ + dialog tổng kết; trang xem live TikTok-style (highlight, toast, Đơn của bạn); Trang chủ 2 nhánh live/offline. Kiểm tra: lint / tsc / test / build đều PASS.
- **Plan 2 — AI/RAG 24/7 (tiếp theo):** Inbox, embedding local + Groq (điền `GROQ_API_KEY` khi làm), takeover, tra đơn. **Chưa có trong Plan 1.**
- **Plan 3 — Dashboard & đóng gói demo:** doanh thu/biểu đồ, quản lý sản phẩm/KB/đơn, kịch bản demo giấy.
