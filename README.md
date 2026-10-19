# LiveOrder — demo livestream bán hàng

Ứng dụng demo bán hàng qua livestream (đồ án tốt nghiệp): người bán lên sóng bằng webcam, người mua xem và **chốt đơn ngay trong bình luận** (`SP01 2 cái` → hệ thống bắt mã bằng Aho-Corasick, trừ kho nguyên tử, tạo đơn realtime). Toàn bộ chạy trên một process Next.js + socket.io tự viết.

> Trạng thái: **Plan 1 (lõi livestream) và Plan 2 (Inbox AI 24/7) đã hoàn tất** — xem mục [Trạng thái dự án](#12-trạng-thái-dự-án).

## 1. Yêu cầu

- **Node.js 20+** và npm.
- **Docker** (Docker Desktop trên Windows/macOS) — PostgreSQL chạy trong container.
- **Windows:** các lệnh bên dưới viết theo Git Bash; PowerShell dùng lệnh tương đương (xem chú thích). Nếu PowerShell chặn `npm`/`npx` (execution policy), dùng `npm.cmd` / `npx.cmd`.

## 2. Quickstart (6 bước)

```bash
# 1) Cài dependencies — postinstall tự chạy `prisma generate`
npm install

# 2) Tạo file .env từ mẫu rồi mở chỉnh
#    (đổi JWT_SECRET trước khi demo thật; điền GROQ_API_KEY để AI Inbox trả lời thật)
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
| `npm run dev` | Chạy custom server `tsx server.ts` — Next dev + socket.io namespace `/live` và `/inbox` cùng process, port `PORT` (mặc định 3000). |
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
| `GROQ_API_KEY` | Key Groq cho Inbox AI 24/7. Có key → AI trả lời thật; thiếu key → AI trả bản fallback toàn bộ KB của shop (không crash, không bịa). |
| `GROQ_MODEL` | Model Groq dùng cho Inbox (mặc định `qwen/qwen3.8-27b`) — đổi nếu key của bạn mở model khác (xem danh sách model qua `/openai/v1/models` của Groq). |
| `PAYMENT_REMIND_DELAY_MS` | Tuỳ chọn — số ms trước khi nhắc thanh toán đơn PENDING (mặc định `300000` = 5 phút; đặt `2000` để demo/smoke khỏi chờ). |
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

## 7. Kịch bản demo "2 cửa sổ" (13 bước)

Cần 2 cửa sổ: một **thường** cho shop, một **ẩn danh (incognito)** cho khách — cookie phiên dùng chung cho mọi tab cùng profile, nên bắt buộc mở ẩn danh.

**Phần A — chốt đơn trong live (bước 1–8):**

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

**Phần B — Inbox AI 24/7 (bước 9–13):**

9. **Cửa sổ khách** — vào Inbox: bấm **💬 Inbox** trên header, hoặc thẻ shop ở trang chủ → **💬 Nhắn tin**, hoặc nút **💬 Tư vấn** ngay trong trang đang xem live. Hội thoại với shop mở ra.
10. Khách hỏi **"1m68 62kg mặc size gì?"** → chờ vài giây, **AI trả lời thật** kèm **chip nguồn** (📚 *Bảng size…*). Bật công tắc **🛠 Kỹ thuật** để mở **Truy vết RAG**: model, topK + điểm, giá/kho lúc trả lời, token, số ms.
11. Khách hỏi **"đơn của mình sao rồi?"** → AI trả lời bằng **template đọc thẳng DB** (đúng đơn mới nhất của chính khách, chip 🧾 Đơn #…) — không gọi model nên trạng thái không bao giờ bịa.
12. **Cửa sổ shop** — mở tab mới tới `/seller/inbox` (cùng cửa sổ thường, cookie dùng chung): gõ trả lời → khách nhận banner **"🔔 Nhân viên shop đã tiếp quản — AI tạm dừng trả lời."** và AI im lặng với câu hỏi kế tiếp; bấm **↩︎ Trả lời cho AI** → khách hỏi tiếp, AI trả lời lại. Phía shop mỗi tin AI có sẵn khối **"Vì sao AI trả lời thế này?"**.
13. Nhắc thanh toán: đơn còn **PENDING** sau bước 7 (chưa thanh toán) được nhắc **đúng 1 lần** trong Inbox khách — ngay khi live kết thúc, hoặc sau 5 phút kể từ lúc chốt (rút ngắn bằng `PAYMENT_REMIND_DELAY_MS=2000` khi demo). Đơn đã thanh toán (PAID) thì không bao giờ bị nhắc — đường thanh toán QR thuộc Plan 3.

> Giao lại giữa AI và người bán là **hai chiều, tức thời**: seller gõ là AI dừng ngay (kể cả câu trả lời đang "bay"); bấm trả-AI thì câu hỏi kế tiếp đã có AI đỡ. Hai shop **không lẫn dữ liệu**: đăng nhập `baoan@demo.vn`, nhắn hỏi `SP01 giá bao nhiêu?` → trả lời đúng bảng giá *Shop Áo Sơ Mi Bảo An* (200.000đ), dù shop đang offline.

## 8. Cú pháp chốt đơn trong live

- Gõ **mã SKU** + **số lượng viết rời** phía sau, ví dụ: `SP01 2 cái`, `SP03 3 chiếc`, `lấy SP02 1`.
- **Số lượng** (tuỳ chọn): số **1–2 chữ số đứng rời** trong vòng 20 ký tự sau mã — `SP01 2 cái` → 2. Viết dính (`x2`, `SP012`) hoặc số từ 3 chữ số trở lên → hiểu là **1** (`SP01 100 cái` → 1); không ghi số cũng là 1.
- Mã sản phẩm: **Shop Thời Trang Linh: `SP01`–`SP07`**; **Shop Áo Sơ Mi Bảo An: `SP01`–`SP03`** (mỗi shop một bảng giá/kho riêng — `SP01` của hai shop là hai sản phẩm khác nhau).
- Mỗi bình luận **chốt một đơn cho mã ĐẦU TIÊN khớp**. Có thể nhắc nhiều mã trong cùng bình luận — tất cả đều được highlight, nhưng chỉ mã đầu tạo đơn; muốn chốt nhiều mã thì gõ từng bình luận.
- Bình luận chứa **số điện thoại được che tự động** trước khi hiển thị (ví dụ `0912***678`).
- **Hết kho**: hệ thống phát dòng `"SPxx đã hết hàng"`, không tạo đơn, kho không bao giờ âm (hai khách cùng chốt khi kho còn 1 → đúng 1 người thắng).
- **Chống trùng**: double-click / gửi lặp do mạng lag không tạo đơn trùng.

## 9. Inbox AI 24/7 (Plan 2)

Ngoài khung bình luận live, mỗi shop có **Inbox chat 1-1**: khách nhắn ngoài giờ vẫn được AI tư vấn 24/7 dựa trên **đúng dữ liệu của shop đó**.

- **AI trả lời bằng RAG** — câu hỏi được truy hồi bằng embedding chạy **local** (multilingual-e5-small; dữ liệu shop không gửi cho dịch vụ embedding), ghép top-k KB + toàn bộ giá/kho đọc tươi từ DB, rồi gọi **Groq** sinh câu trả lời. Thiếu key Groq → AI trả bản **fallback toàn bộ KB** của shop (không bịa, không crash).
- **Tra đơn** — câu hỏi có "đơn / thanh toán / #mã" trả lời bằng **template đọc thẳng DB**, scope đúng `buyerId` + `shopId`: chỉ đơn của chính khách trong đúng shop, không rò đơn người khác/shop khác.
- **Seller tiếp quản (takeover)** — seller trả lời tay ở `/seller/inbox` thì AI **dừng ngay** (kể cả câu trả lời đang bay) và khách thấy banner tiếp quản; bấm **↩︎ Trả lời cho AI** để giao lại.
- **Nhắc thanh toán** — đơn PENDING được nhắc **đúng 1 lần/đơn** trong Inbox (sau 5 phút, hoặc ngay khi live kết thúc; chồng nhau vẫn 1 tin nhờ dedup mức DB). Đơn đã PAID không bao giờ bị nhắc.
- **Badge đêm** — `/seller/inbox` hiện `🌙 AI đã xử lý N hội thoại trong đêm (22h–6h)` (giờ Việt Nam); seed có sẵn hội thoại ban đêm để thấy số ngay.

Điểm vào:

| Vai | Đường vào |
| --- | --- |
| Khách | **💬 Inbox** trên header (đã đăng nhập) · thẻ shop ở trang chủ → **💬 Nhắn tin** · nút **💬 Tư vấn** trong trang live. |
| Shop | Mở `/seller/inbox` (tab mới cùng cửa sổ thường — dùng chung cookie phiên). |

Cần cho AI thật: `GROQ_API_KEY` trong `.env`; model mặc định `qwen/qwen3.8-27b`, đổi bằng `GROQ_MODEL` nếu key của bạn mở model khác (xem danh sách model của key qua `/openai/v1/models` của Groq).

> **Lần đầu hỏi AI sẽ hơi chậm:** model embedding ~113 MB tải một lần vào `.cache/transformers/` (đã gitignore) — cần internet đúng lần đầu, các lần sau chạy hoàn toàn local.

## 10. Ghi chú version

- **Next.js 16.4.2** (App Router; plan gốc ghi 15 — deviation đã được chấp nhận), **React 19.3**, **Tailwind CSS v4**, **Prisma 7** (Prisma Client sinh vào `generated/prisma`, cấu hình URL nằm ở `prisma.config.ts`), socket.io 4.
- Next 16 đổi `middleware.ts` → **`proxy.ts`** (chặn `/seller/*`, `/inbox/*`, `/orders/*` khi chưa đủ quyền).
- Next 16 + Cache Components: các trang đọc cookie/DB (`/`, `/live/[id]`, `/seller/studio`) render theo từng request — trạng thái live đổi là HTML đổi ngay.
- `npm run dev` / `npm run start` dùng **custom server `tsx server.ts`**; đừng thay bằng `next dev`/`next start` (mất socket.io).
- Inbox AI (Plan 2): embedding local bằng **`@huggingface/transformers`** (multilingual-e5-small, cache `.cache/transformers/`), gọi Groq bằng `fetch` thuần (không SDK); chỉ số RAG giữ trong RAM theo shop (`globalThis`, tự dựng lại khi KB/sản phẩm đổi).

## 11. Xử lý sự cố nhanh

| Triệu chứng | Cách xử lý |
| --- | --- |
| `docker compose up -d` báo port 5433 bận | Tắt container/project khác đang giữ 5433 (`docker ps`), hoặc đổi map port trong `docker-compose.yml` **và** `DATABASE_URL`/`TEST_DATABASE_URL` cho khớp. |
| `npm test` báo `TEST_DATABASE_URL is not set` | Chưa có `.env` — copy từ `.env.example`. |
| `npm test` lỗi kết nối / migrate vào `liveorder_test` | Docker chưa chạy hoặc container chưa lên: `docker compose up -d` rồi chạy lại. |
| Camera không mở ở Studio | Webcam chỉ chạy ở `http://localhost` hoặc HTTPS (không chạy qua IP LAN `http://`), cần cấp quyền camera cho trình duyệt và không để app khác giữ webcam. |
| `npm run seed` báo lỗi unique | Dữ liệu cũ lệch id: `npx prisma migrate reset` (xoá sạch DB dev) rồi `npm run seed`. |
| Lỗi import `generated/prisma` sau khi clone | `npx prisma generate` (thường đã tự chạy ở `npm install`). |
| Port 3000 bận | Đổi `PORT` trong `.env` và mở lại đúng port mới. |
| AI Inbox không trả lời (tin xin lỗi / fallback) | Kiểm `GROQ_API_KEY` trong `.env`; nếu 404 model_not_found → đổi `GROQ_MODEL` sang model key đang mở. Xem chi tiết ngay trong app: phía khách bật **🛠 Kỹ thuật**, phía shop mở khối **"Vì sao AI trả lời thế này?"** để đọc `model`/`error`. |
| Câu hỏi đầu tiên bị chậm vài chục giây | Lần đầu đang tải model embedding ~113 MB vào `.cache/transformers/` (cần internet một lần). Các lần sau chỉ ~vài giây. |
| Không thấy tin nhắc thanh toán | Mặc định nhắc sau **5 phút** kể từ lúc chốt đơn; kết thúc live sẽ nhắc ngay các đơn còn PENDING. Muốn thấy liền khi demo: `PAYMENT_REMIND_DELAY_MS=2000` trước khi chạy server. Mỗi đơn chỉ nhắc **1 lần**. |
| Muốn reset dữ liệu demo | `npx prisma migrate reset` (xoá toàn bộ) + `npm run seed`; hoặc chỉ `npm run seed` để khôi phục giá/kho về chuẩn (đơn cũ vẫn giữ). |

## 12. Trạng thái dự án

- **Plan 1 — Lõi livestream (T1–T15): ✅ hoàn tất.** Auth + seed 2 shop; custom server + socket `/live` xác thực JWT; Aho-Corasick bắt SKU + highlight + đo `ms` thật; tạo đơn & trừ kho nguyên tử; chống trùng nonce; che SĐT; Studio webcam + log engine + đơn nổ + dialog tổng kết; trang xem live TikTok-style (highlight, toast, Đơn của bạn); Trang chủ 2 nhánh live/offline. Kiểm tra: lint / tsc / test / build đều PASS.
- **Plan 2 — Inbox AI 24/7 (T1–T12): ✅ hoàn tất.** Inbox khách `/inbox` + inbox shop `/seller/inbox`; socket `/inbox` xác thực JWT; embedding local (multilingual-e5-small) + RAG top-k theo shop + Groq (`qwen/qwen3.8-27b`), tra đơn bằng template đọc DB, fallback toàn-KB khi Groq lỗi; takeover + trả-AI tức thời (thắng cả câu trả lời đang bay, hủy im lặng); nhắc thanh toán 1 lần/đơn (timer 5' + hook end-live, dedup DB); badge đêm 22h–6h; chip nguồn + Truy vết RAG (khách) / "Vì sao AI trả lời thế này?" (shop); điểm vào **💬 Inbox / Nhắn tin / Tư vấn**. Kiểm tra: lint / tsc / test (186 pass) / build PASS + smoke 2 phiên thật (curl + socket.io, kèm báo cáo).
- **Plan 3 — Dashboard & đóng gói demo (bước tiếp theo):** doanh thu/biểu đồ, quản lý sản phẩm/KB/đơn, thanh toán QR, đóng gói kịch bản demo.
