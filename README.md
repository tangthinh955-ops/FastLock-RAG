# LiveOrder — demo livestream bán hàng

Ứng dụng demo bán hàng qua livestream (đồ án tốt nghiệp): người bán lên sóng bằng webcam, người mua xem và **chốt đơn ngay trong bình luận** (`SP01 2 cái` → hệ thống bắt mã bằng Aho-Corasick, trừ kho nguyên tử, tạo đơn realtime). Toàn bộ chạy trên một process Next.js + socket.io tự viết.

> Trạng thái: **Plan 1 (lõi livestream), Plan 2 (Inbox AI 24/7) và Plan 3 (đơn hàng/QR, quản trị shop, Dashboard, đóng gói demo) đã hoàn tất** — xem mục [Trạng thái dự án](#14-trạng-thái-dự-án).

## 1. Yêu cầu

- **Node.js 20+** và npm.
- **Docker** (Docker Desktop trên Windows/macOS) — PostgreSQL chạy trong container.
- **Windows:** các lệnh bên dưới viết theo Git Bash; PowerShell dùng lệnh tương đương (xem chú thích). Nếu PowerShell chặn `npm`/`npx` (execution policy), dùng `npm.cmd` / `npx.cmd`.
- **Internet lần đầu** để tải model embedding (~113 MB, lưu vào `.cache/transformers/`). Mã QR thanh toán sinh **hoàn toàn local** bằng package `qrcode` — không cần mạng.

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

- `.env.example` đã đặt sẵn `DEMO_MODE=true` — cần cho **đăng nhập nhanh**, luồng comment giả lập và nút **Giả lập đã chuyển khoản**. Đặt `false` thì các tính năng demo này tắt (API trả 404/403).
- Ba biến `DEMO_BANK_ID`, `DEMO_BANK_ACCOUNT`, `DEMO_BANK_OWNER` chỉ là **thông tin ngân hàng giả** để in lên QR demo; không phải tài khoản thật.
- **Không dùng `next dev` / `next start`** — phải chạy `npm run dev` / `npm run start` để có custom server `tsx server.ts` gắn socket.io.

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
| `npm run build` | Build production (`next build`). Cần `.env` và DB đang chạy (một số bước build đọc cấu hình DB). |
| `npm run lint` | ESLint toàn repo. |
| `npm test` | Vitest (một lượt). **Cần Docker**: global-setup tự migrate `TEST_DATABASE_URL` (`liveorder_test`) trước khi chạy. |
| `npm run test:watch` | Vitest watch mode. |
| `npm run seed` | Nạp/khôi phục dữ liệu demo (upsert theo id cố định — chạy lại không nhân đôi). Seed gồm nền (5 tài khoản, 2 shop, 10 sản phẩm, 9 KB) + lịch sử (5 hội thoại/20 tin nhắn, 2 phiên live cũ, 5 đơn cũ). Chạy lại sẽ **đưa giá/kho/tên sản phẩm seed và nội dung KB seed về đúng chuẩn**, không xoá đơn cũ, không xoá sản phẩm/KB tự thêm. |

Kiểm tra chất lượng trước khi commit/demo:

```bash
npx next typegen     # sinh route type cho Next 16 (không commit .next)
npx tsc --noEmit
npm run lint
npm test
npm run build
```

## 5. Biến môi trường

Copy từ `.env.example` → `.env` (file `.env` đã bị gitignore, **không commit**):

| Biến | Ý nghĩa |
| --- | --- |
| `DATABASE_URL` | `postgresql://liveorder:liveorder@localhost:5433/liveorder` — DB dev. |
| `TEST_DATABASE_URL` | `...:5433/liveorder_test` — DB test cho `npm test`. Bắt buộc phải khác `DATABASE_URL` (global-setup chặn nếu trùng). |
| `JWT_SECRET` | Khoá ký JWT phiên đăng nhập — **đổi trước khi demo thật**. |
| `DEMO_MODE` | `true`: bật đăng nhập nhanh, suối comment giả lập, số người xem ảo **và nút giả lập thanh toán**. `false`: `/api/auth/demo-login` trả 404, giả lập khách không chạy, `POST /api/orders/[id]/pay` trả 403. |
| `GROQ_API_KEY` | Key Groq cho Inbox AI 24/7. Có key → AI trả lời thật; thiếu key → AI trả bản fallback toàn bộ KB của shop (không crash, không bịa). |
| `GROQ_MODEL` | Model Groq dùng cho Inbox (mặc định `qwen/qwen3.8-27b`) — đổi nếu key của bạn mở model khác (xem danh sách model qua `/openai/v1/models` của Groq). |
| `PAYMENT_REMIND_DELAY_MS` | Tuỳ chọn — số ms trước khi nhắc thanh toán đơn PENDING (mặc định `300000` = 5 phút; đặt `2000` để demo/smoke khỏi chờ). |
| `DEMO_BANK_ID` | Mã ngân hàng in trên QR demo (mặc định `970436`). Chỉ là dữ liệu minh hoạ. |
| `DEMO_BANK_ACCOUNT` | Số tài khoản in trên QR demo (mặc định `0000000000`). Không phải tài khoản thật. |
| `DEMO_BANK_OWNER` | Tên chủ tài khoản in trên QR demo (mặc định `LIVEORDER DEMO`). |
| `PORT` | Port app (mặc định `3000`). |

Không có biến nào chứa bí mật thật trong repo; README chỉ liệt kê **tên biến**, không ghi giá trị bí mật.

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

## 7. Đơn hàng & thanh toán demo

Luồng chuẩn: **PENDING → QR → giả lập chuyển khoản → PAID + tin SYSTEM**.

- Khách chốt đơn trong live → đơn tạo ở trạng thái **PENDING**, kho đã bị trừ. Khách mở `/orders` bằng link **🧾 Đơn của tôi** trên header, hoặc thẻ **📦 Đơn của bạn** / link **Xem đơn & QR →** trong trang live.
- Đơn PENDING hiện **QR sinh local** (`qrcode`) + thông tin ngân hàng demo + `paymentCode`. QR và thông tin ngân hàng **chỉ để minh hoạ**; quét bằng app ngân hàng thật sẽ **không chuyển tiền** và không có webhook nào xác nhận.
- Nút **Giả lập đã chuyển khoản** gọi `POST /api/orders/[id]/pay` (chỉ khi `DEMO_MODE=true`). Server kiểm tra đơn thuộc đúng khách + còn PENDING, rồi trong một transaction đặt `status=PAID` + `paidAt`, và ghi **đúng một** tin SYSTEM vào hội thoại khách↔shop:
  `✅ Đã nhận thanh toán đơn #<code> — <SP> ×<qty> — <total>đ. Shop sẽ chuẩn bị hàng ngay!`
- Tin SYSTEM phát realtime qua socket `/inbox`: khách thấy ngay trong Inbox; seller đang mở `/seller/inbox` thấy hội thoại nhảy lên đầu kèm tin thanh toán.
- **PAID không hủy được** trong bản demo (không có hoàn tiền). Seller chỉ có thể chuyển PAID → **SHIPPED** (giao hàng). PENDING → **CANCELLED** được phép và **hoàn kho**.
- Đơn PENDING còn được **nhắc thanh toán đúng 1 lần** trong Inbox (sau 5 phút hoặc ngay khi live kết thúc); đơn PAID không bao giờ bị nhắc.
- Không có tích hợp ngân hàng/webhook thật, không có hoàn tiền, không có đối soát giao dịch.

## 8. Quản trị shop

Seller đăng nhập thấy thanh điều hướng trong `HomeHeader`: **📊 Dashboard · 🎥 Studio · 💬 Inbox · 🛍️ Sản phẩm · 📚 KB · 🧾 Đơn**.

| Trang | Việc làm được |
| --- | --- |
| `/seller` | Dashboard doanh thu/đơn/top SP/hiệu quả AI theo khoảng Hôm nay · 7 ngày · 30 ngày (định nghĩa ở mục 9). |
| `/seller/products` | Thêm/sửa/xoá sản phẩm; SKU duy nhất trong shop; giá và kho là số nguyên không âm. Upload ảnh **JPG/PNG/WEBP ≤ 2 MB**, lưu vào `public/uploads/` (thư mục đã gitignore, cần filesystem ghi được). Sửa tên/SKU làm index RAG của shop bị invalidate → câu trả lời AI dùng dữ liệu mới ngay. Sản phẩm đã có đơn **không xoá được** (409) — hãy sửa thay vì xoá. |
| `/seller/kb` | Thêm/sửa/xoá mục kiến thức (tiêu đề 1–120 ký tự, nội dung 1–4000 ký tự). Mỗi mutation invalidate index RAG → câu hỏi kế tiếp của khách nhận câu trả lời mới, không cần restart. |
| `/seller/orders` | Bảng đơn của đúng shop: PENDING → **Hủy đơn** (confirm, hoàn kho trong cùng transaction); PAID → **Giao hàng** (SHIPPED); SHIPPED/CANCELLED chỉ xem. Đơn PAID **không có nút hủy**. |
| `/seller/inbox` | Inbox shop: trả lời tay (takeover), xem “Vì sao AI trả lời thế này?”, badge đêm, danh sách hội thoại realtime. |
| `/seller/studio` | Bắt đầu/kết thúc live, webcam preview, comment + đơn nổ realtime, log engine, popup tổng kết → **📊 Xem Dashboard chi tiết**. |

Mọi trang seller lấy `shopId` từ JWT → `Shop.ownerId`, không nhận `shopId` từ URL/client; dữ liệu shop khác không đọc/sửa được.

## 9. Dashboard — định nghĩa từng chỉ số

Bộ lọc **Hôm nay / 7 ngày / 30 ngày**, biên ngày theo **lịch Việt Nam (UTC+7, không DST)**, khoảng đóng đầu — mở cuối `[start, now)`:

- **Hôm nay:** từ 00:00 hôm nay (giờ VN).
- **7 ngày:** từ 00:00 của **6 ngày trước** → **gồm hôm nay** (tổng 7 ngày lịch).
- **30 ngày:** từ 00:00 của **29 ngày trước** → **gồm hôm nay**.
- Thiếu/`?range=` lạ → mặc định **7 ngày**.

| Chỉ số | Định nghĩa trong code |
| --- | --- |
| **Doanh thu thực thu** | `sum(total)` của đơn có `paidAt != null` và `paidAt` nằm trong khoảng — gồm **PAID + SHIPPED**; loại PENDING/CANCELLED. Đơn tạo trước khoảng nhưng thanh toán trong khoảng vẫn được tính doanh thu. |
| **Đơn theo trạng thái** | Đếm đơn có **`createdAt`** trong khoảng, theo **trạng thái hiện tại** (PENDING/PAID/SHIPPED/CANCELLED). Vì vậy một đơn có thể không nằm trong “đơn tạo trong khoảng” nhưng vẫn đóng góp doanh thu nếu `paidAt` rơi vào khoảng. |
| **SP đã bán** | `sum(qty)` của đơn đã thu tiền (`paidAt` trong khoảng). |
| **Đỉnh người xem** | `max(peakViewers)` của các phiên live có **`startedAt`** trong khoảng; `0` nếu không có phiên. |
| **Doanh thu theo giờ** | 24 cột theo **giờ Việt Nam của `paidAt`**, chỉ đơn đã thu tiền trong khoảng. |
| **Top 5 sản phẩm** | Theo đơn đã thu tiền trong khoảng: `qty` giảm dần → doanh thu giảm dần → SKU tăng dần; tối đa 5. |
| **Hội thoại có AI** | Số hội thoại **khác nhau** có ít nhất một tin `source=AI` với `createdAt` trong khoảng. |
| **Hội thoại ban đêm** | Như trên nhưng tin AI rơi vào khung **22:00–06:00 giờ VN**. |
| **Thời gian trả lời TB** | Trung bình `trace.elapsedMs` của các tin AI **đọc được trace** trong khoảng; hiển thị 1 chữ số thập phân (giây). Không có trace → `—`. Tin AI cũ/thiếu trace bị loại khỏi phép chia. |
| **Câu hỏi phổ biến** | Tin `source=BUYER` trong khoảng, chuẩn hoá `trim + gộp khoảng trắng + lowercase` để gom biến thể; đếm số lần, hiển thị nội dung gốc của tin **mới nhất**, top 5 theo số lần giảm dần rồi text. |

Seed có sẵn lịch sử để Dashboard có số ngay: 5 hội thoại (9 tin AI có trace), 2 phiên live cũ, 5 đơn cũ (PAID/SHIPPED/CANCELLED) rải trong 30 ngày — nên **Hôm nay / 7 ngày / 30 ngày ra số khác nhau** và khối AI không hiện `—` ngay từ đầu.

## 10. Kịch bản demo "2 cửa sổ" (~10 phút)

Cần 2 cửa sổ: một **thường** cho shop, một **ẩn danh (incognito)** cho khách — cookie phiên dùng chung cho mọi tab cùng profile, nên bắt buộc mở ẩn danh. Không mở hai tài khoản khác nhau trong cùng một cửa sổ thường.

### Trước khi bấm giờ (chuẩn bị)

1. `docker compose up -d` → `npm run seed` (khôi phục kho/giá/KB; đơn cũ vẫn còn). Muốn sạch tuyệt đối: `npx prisma migrate reset` rồi `npm run seed` (**xoá toàn bộ DB dev**, kể cả đơn cũ).
2. `.env`: `DEMO_MODE=true`, `GROQ_API_KEY` thật; tuỳ chọn `PAYMENT_REMIND_DELAY_MS=2000` để thấy nhắc thanh toán nhanh.
3. `npm run dev` → mở `http://localhost:3000`; đăng nhập thử cả 2 vai.
4. **Làm nóng AI** trước giờ demo: hỏi một câu trong Inbox để tải model embedding (~113 MB lần đầu) — tránh câu hỏi đầu tiên bị chậm trước hội đồng.

### Phần A — live + chốt đơn + AI + thanh toán (0:00–7:00)

1. **Cửa sổ thường** — `/login` → **🏪 Shop demo** → `/seller/studio`. Nhập **tiêu đề live** → **Bắt đầu phiên live**; cấp quyền webcam (preview chỉ phía seller). Comment mẫu và số 👀 bắt đầu chảy khi `DEMO_MODE=true`.
2. **Cửa sổ ẩn danh** — `/login` → **👤 Khách demo** → Trang chủ `/` → thẻ shop đang live → **Xem live →** (`/live/{id}`).
3. **Cốt lõi ① — Aho-Corasick:** khách gõ `SP01 2 cái` → **Gửi**. Quan sát cả 2 cửa sổ:
   - Khách: `SP01` highlight, dòng `⚡ Bắt SKU 0,x ms → tạo Đơn #X`, toast đơn nổ, thẻ **📦 Đơn của bạn**.
   - Shop: đơn mới trong **🧾 Đơn nổ realtime** + log `⚙️ … bắt "SP01" → Đơn #X · 0,x ms` (số ms thật).
4. **Cốt lõi ② — RAG:** khách bấm **💬 Tư vấn** (hoặc **💬 Inbox** trên header) → hỏi **“1m68 62kg mặc size gì?”** → AI trả lời theo bảng size + **chip nguồn** (`📚 Bảng size…`). Bật công tắc **🛠 Kỹ thuật** để mở **Truy vết RAG**: model, topK + điểm, giá/kho lúc trả lời, token, số ms.
5. **Hậu mãi “ngoài giờ”:** hỏi **“mặc chật đổi size được không, phí ai chịu?”** → AI trả lời đúng điều khoản (đổi trả 7 ngày; đổi size khách chịu phí ship hai chiều; lỗi shop chịu). Đây là kịch bản AI 24/7: câu trả lời không phụ thuộc việc shop có đang live hay offline.
6. **Tra đơn:** hỏi **“đơn của mình sao rồi?”** → AI trả lời bằng **template đọc thẳng DB** (đơn mới nhất của chính khách, trạng thái “chờ thanh toán”, chip 🧾 Đơn #…) — không gọi model nên không bịa trạng thái.
7. **Kết thúc live:** shop bấm **■ Kết thúc live** → popup **“Live đã kết thúc”** với **Đơn đã chốt** + **Doanh thu đã thu**. Bấm **📊 Xem Dashboard chi tiết** để kiểm tra link hoạt động (có thể quay lại Studio sau). Sau đó shop mở **💬 Inbox** (`/seller/inbox`) và chọn hội thoại với **Khách** để chuẩn bị xem tin thanh toán.
8. **Thanh toán demo:** cửa sổ khách mở **🧾 Đơn của tôi** (`/orders`) → chọn đơn vừa chốt (PENDING) → thấy **QR** + ngân hàng demo + `paymentCode` → bấm **Giả lập đã chuyển khoản**.
   - Đơn chuyển **Đã thanh toán (PAID)** ngay, hiện `paidAt`, QR biến mất.
   - Khách nhận tin SYSTEM `✅ Đã nhận thanh toán đơn #…` trong Inbox.
   - Shop (đang mở `/seller/inbox`) thấy hội thoại **nhảy lên đầu** + tin SYSTEM thanh toán.
9. **Dashboard:** shop bấm **📊 Dashboard** → kiểm tra:
   - Doanh thu tăng đúng bằng đơn vừa thanh toán (đơn PAID/SHIPPED).
   - **Hôm nay / 7 ngày / 30 ngày** cho ra số khác nhau (nhờ lịch sử seed).
   - Biểu đồ doanh thu theo giờ dồn vào giờ vừa thanh toán; **Top 5 sản phẩm** khớp; **Hiệu quả AI** có số và thời gian trả lời TB không phải `—`.
10. **Takeover — người thật luôn thắng máy:** tại `/seller/inbox`, shop gõ trả lời trực tiếp → khách thấy banner **“🔔 Nhân viên shop đã tiếp quản — AI tạm dừng trả lời.”**; khách hỏi thêm → AI **im**. Shop bấm **↩︎ Trả lời cho AI** → khách hỏi câu kế tiếp → AI trả lời lại.

### Phần B — chống lẫn shop & huỷ đơn (7:00–10:00)

11. **Chống lẫn shop:** từ Trang chủ, khách bấm **💬 Nhắn tin** ở shop **Áo Sơ Mi Bảo An** (đang offline) → hỏi **“SP01 giá bao nhiêu?”** → AI trả lời **200.000đ**, đổi trả **3 ngày**, freeship **không có** — đúng shop 2, không lẫn shop 1.
12. **Mở lại live cho Phần B:** live đã kết thúc ở bước 7 nên hiện không còn phiên nào chạy. Shop về `/seller/studio` → nhập **tiêu đề live mới** → **Bắt đầu phiên live**; cửa sổ khách (ẩn danh) vào Trang chủ `/` → thẻ shop đang live → **Xem live →** (`/live/{id}`). Bước này bắt buộc để có live cho bước 13.
13. **Huỷ đơn hoàn kho:** khách chốt thêm một đơn PENDING (ví dụ `SP03 1 cái` trong live vừa mở lại ở bước 12). Shop mở **🧾 Đơn** (`/seller/orders`) → bấm **Hủy đơn** trên đơn PENDING → confirm “Kho sẽ được hoàn lại.” → sang **🛍️ Sản phẩm** thấy kho `+1`; đơn PAID **không có nút Hủy**.
14. **Sửa KB tại chỗ (tuỳ chọn, rất hiệu quả):** shop mở **📚 KB** → sửa “Chính sách đổi trả 7 ngày” thành “Đổi trả 10 ngày” (hoặc thêm câu mới) → lưu → khách hỏi lại trong Inbox → AI trả lời theo nội dung **mới ngay**, không cần restart.
15. **Tuỳ chọn kỹ thuật:** demo “kho còn 1, hai khách chốt cùng lúc”: sửa kho một SP về 1 ở `/seller/products`, dùng thêm một cửa sổ ẩn danh thứ hai, cả hai gõ cùng mã → chỉ **một** đơn thành công, kho không âm, phía còn lại nhận “đã hết hàng”.

### Phương án dự phòng khi demo

| Tình huống | Xử lý |
| --- | --- |
| **Groq lỗi / rate limit / mất mạng** | AI tự trả bản **fallback toàn bộ KB** của shop kèm lời xin lỗi; Inbox vẫn dùng được, không crash. Bật **🛠 Kỹ thuật** để thấy `error`; chờ vài chục giây rồi hỏi lại. Không cần restart server. |
| **Webcam bị từ chối / không có camera** | Studio hiện khối hướng dẫn (“Không bật được webcam…”) nhưng **phần còn lại vẫn hoạt động**. Tiếp tục live bằng **🎭 Giả lập khách** để comment chảy; nhớ nói rõ đây là preview phía seller, khách không nhận video thật. |
| **DB down / Docker tắt** | `docker compose up -d`, chờ container healthy rồi tải lại trang. Nếu dữ liệu hỏng: `npx prisma migrate reset` + `npm run seed` (xoá sạch DB dev). |
| **Mất mạng giữa live** | App local vẫn chạy; Groq rơi về fallback. Socket có thể lỡ tin — **không có backfill**, hãy tải lại cả 2 cửa sổ; nếu dữ liệu rối, chạy lại `npm run seed` (khôi phục kho/giá/KB) và bắt đầu phiên mới. |
| **AI chậm ở câu đầu** | Model embedding đang tải (~113 MB). Đã “làm nóng” ở bước chuẩn bị; nếu chưa, hỏi một câu thử trước khi vào kịch bản chính. |
| **Port 3000 bận** | Đổi `PORT` trong `.env` và mở đúng port mới; nhớ dùng `npm run dev`, không dùng `next dev`. |

## 11. Cú pháp chốt đơn trong live

- Gõ **mã SKU** + **số lượng viết rời** phía sau, ví dụ: `SP01 2 cái`, `SP03 3 chiếc`, `lấy SP02 1`.
- **Số lượng** (tuỳ chọn): số **1–2 chữ số đứng rời** trong vòng 20 ký tự sau mã — `SP01 2 cái` → 2. Viết dính (`x2`, `SP012`) hoặc số từ 3 chữ số trở lên → hiểu là **1** (`SP01 100 cái` → 1); không ghi số cũng là 1.
- Mã sản phẩm: **Shop Thời Trang Linh: `SP01`–`SP07`**; **Shop Áo Sơ Mi Bảo An: `SP01`–`SP03`** (mỗi shop một bảng giá/kho riêng — `SP01` của hai shop là hai sản phẩm khác nhau).
- Mỗi bình luận **chốt một đơn cho mã ĐẦU TIÊN khớp**. Có thể nhắc nhiều mã trong cùng bình luận — tất cả đều được highlight, nhưng chỉ mã đầu tạo đơn; muốn chốt nhiều mã thì gõ từng bình luận.
- Bình luận chứa **số điện thoại được che tự động** trước khi hiển thị (ví dụ `0912***678`).
- **Hết kho**: hệ thống phát dòng `"SPxx đã hết hàng"`, không tạo đơn, kho không bao giờ âm (hai khách cùng chốt khi kho còn 1 → đúng 1 người thắng).
- **Chống trùng**: double-click / gửi lặp do mạng lag không tạo đơn trùng.

## 12. Inbox AI 24/7 (Plan 2)

Ngoài khung bình luận live, mỗi shop có **Inbox chat 1-1**: khách nhắn ngoài giờ vẫn được AI tư vấn 24/7 dựa trên **đúng dữ liệu của shop đó**.

- **AI trả lời bằng RAG** — câu hỏi được truy hồi bằng embedding chạy **local** (multilingual-e5-small; dữ liệu shop không gửi cho dịch vụ embedding), ghép top-k KB + toàn bộ giá/kho đọc tươi từ DB, rồi gọi **Groq** sinh câu trả lời. Thiếu key Groq → AI trả bản **fallback toàn bộ KB** của shop (không bịa, không crash).
- **Tra đơn** — câu hỏi có "đơn / thanh toán / #mã" trả lời bằng **template đọc thẳng DB**, scope đúng `buyerId` + `shopId`: chỉ đơn của chính khách trong đúng shop, không rò đơn người khác/shop khác.
- **Seller tiếp quản (takeover)** — seller trả lời tay ở `/seller/inbox` thì AI **dừng ngay** (kể cả câu trả lời đang bay) và khách thấy banner tiếp quản; bấm **↩︎ Trả lời cho AI** để giao lại.
- **Nhắc thanh toán** — đơn PENDING được nhắc **đúng 1 lần/đơn** trong Inbox (sau 5 phút, hoặc ngay khi live kết thúc; chồng nhau vẫn 1 tin nhờ dedup mức DB). Đơn đã PAID không bao giờ bị nhắc. Nội dung nhắc hướng khách mở **Đơn của tôi** để thanh toán.
- **Badge đêm** — `/seller/inbox` hiện `🌙 AI đã xử lý N hội thoại trong đêm (22h–6h)` (giờ Việt Nam); seed có sẵn hội thoại ban đêm để thấy số ngay.

Điểm vào:

| Vai | Đường vào |
| --- | --- |
| Khách | **💬 Inbox** trên header (đã đăng nhập) · thẻ shop ở trang chủ → **💬 Nhắn tin** · nút **💬 Tư vấn** trong trang live. |
| Shop | Mở `/seller/inbox` (tab mới cùng cửa sổ thường — dùng chung cookie phiên). |

Cần cho AI thật: `GROQ_API_KEY` trong `.env`; model mặc định `qwen/qwen3.8-27b`, đổi bằng `GROQ_MODEL` nếu key của bạn mở model khác (xem danh sách model của key qua `/openai/v1/models` của Groq).

> **Lần đầu hỏi AI sẽ hơi chậm:** model embedding ~113 MB tải một lần vào `.cache/transformers/` (đã gitignore) — cần internet đúng lần đầu, các lần sau chạy hoàn toàn local.

## 13. Ghi chú version & giới hạn đã biết

### Version

- **Next.js 16.4.2** (App Router; plan gốc ghi 15 — deviation đã được chấp nhận), **React 19.3**, **Tailwind CSS v4**, **Prisma 7** (Prisma Client sinh vào `generated/prisma`, cấu hình URL nằm ở `prisma.config.ts`), socket.io 4.
- Next 16 đổi `middleware.ts` → **`proxy.ts`** (chặn `/seller/*`, `/inbox/*`, `/orders/*` khi chưa đủ quyền).
- Next 16 + Cache Components: các trang đọc cookie/DB (`/`, `/live/[id]`, `/orders`, `/seller/*`) render theo từng request — trạng thái live/đơn đổi là HTML đổi ngay.
- `npm run dev` / `npm run start` dùng **custom server `tsx server.ts`**; đừng thay bằng `next dev`/`next start` (mất socket.io).
- Inbox AI (Plan 2): embedding local bằng **`@huggingface/transformers`** (multilingual-e5-small, cache `.cache/transformers/`), gọi Groq bằng `fetch` thuần (không SDK); chỉ số RAG giữ trong RAM theo shop (`globalThis`, tự dựng lại khi KB/sản phẩm đổi).
- Thanh toán demo (Plan 3): QR sinh local bằng **`qrcode`** (chỉ import ở server component `/orders`); upload ảnh ghi thẳng `public/uploads/`; không dùng SDK ngân hàng.

### Giới hạn đã biết (ghi nhận trung thực — không phải bug ẩn)

- **Không backfill tin nhắn sau khi mất kết nối socket.** Tin đến trong lúc mất mạng có thể không hiện lại; tải lại trang để đọc dữ liệu từ DB. Không có REST catch-up.
- **`npm audit` báo 5 lỗ hổng mức high trong dependency tree (transitive)** tại thời điểm đóng gói Plan 3; chưa chạy `npm audit fix` để tránh đổi version ngoài phạm vi demo.
- **Index RAG nằm trong RAM** theo từng shop: dựng lại sau khi restart server hoặc sau khi sửa KB/sản phẩm (invalidate). Không có vector DB bền vững; index lớn sẽ tốn RAM.
- **Ảnh upload có thể mồ côi:** xoá sản phẩm/đổi ảnh không xoá file cũ trong `public/uploads/`; không có job dọn dẹp.
- **Upload cần filesystem ghi được:** phù hợp chạy local/Node server; không dùng được trên serverless read-only. Giới hạn 2 MB, không nén/resize ảnh.
- **Không có ngân hàng/webhook thật:** QR và thông tin `DEMO_BANK_*` chỉ để minh hoạ; không có giao dịch tiền thật, không đối soát.
- **Không có hoàn tiền:** đơn PAID không huỷ được; chỉ chuyển PAID → SHIPPED. Hoàn tiền ngoài phạm vi demo.
- **Video không được truyền cho khách:** webcam chỉ là preview trong Studio của seller; stage phía khách là khung minh hoạ (gradient), comment/đơn/số người xem mới là realtime.
- **Số người xem khi `DEMO_MODE=true` là số ảo** do bộ giả lập; `peakViewers` của phiên lấy từ dữ liệu phiên, không phải analytics thật.

## 14. Trạng thái dự án

- **Plan 1 — Lõi livestream (T1–T15): ✅ hoàn tất.** Auth + seed 2 shop; custom server + socket `/live` xác thực JWT; Aho-Corasick bắt SKU + highlight + đo `ms` thật; tạo đơn & trừ kho nguyên tử; chống trùng nonce; che SĐT; Studio webcam + log engine + đơn nổ + dialog tổng kết; trang xem live TikTok-style (highlight, toast, Đơn của bạn); Trang chủ 2 nhánh live/offline. Kiểm tra: lint / tsc / test / build đều PASS.
- **Plan 2 — Inbox AI 24/7 (T1–T12): ✅ hoàn tất.** Inbox khách `/inbox` + inbox shop `/seller/inbox`; socket `/inbox` xác thực JWT; embedding local (multilingual-e5-small) + RAG top-k theo shop + Groq (`qwen/qwen3.8-27b`), tra đơn bằng template đọc DB, fallback toàn-KB khi Groq lỗi; takeover + trả-AI tức thời (thắng cả câu trả lời đang bay, hủy im lặng); nhắc thanh toán 1 lần/đơn (timer 5' + hook end-live, dedup DB); badge đêm 22h–6h; chip nguồn + Truy vết RAG (khách) / "Vì sao AI trả lời thế này?" (shop); điểm vào **💬 Inbox / Nhắn tin / Tư vấn**. Kiểm tra: lint / tsc / test (186 pass) / build PASS + smoke 2 phiên thật (curl + socket.io, kèm báo cáo).
- **Plan 3 — Đơn hàng/QR, quản trị shop, Dashboard & đóng gói demo (T1–T7): ✅ hoàn tất (3/3).**
  - `/orders` + QR local + giả lập thanh toán + tin SYSTEM; seller `/seller/orders` giao/hủy hoàn kho; `/seller/products` CRUD + upload ảnh + invalidate RAG; `/seller/kb` CRUD + AI cập nhật ngay; `/seller` Dashboard (doanh thu, đơn, top SP, hiệu quả AI, bộ lọc Hôm nay/7/30); seller nav trong `HomeHeader`; popup kết thúc live mở Dashboard; seed lịch sử có trace để Dashboard có số ngay.
  - Kiểm tra cuối Plan 3 (2026-10-21, máy hiện tại): `npm run seed` OK; `npx next typegen` OK; `npx tsc --noEmit` sạch; `npm run lint` sạch; `npm test` **28 file / 286 passed + 1 skipped**; `npm run build` PASS. HTTP smoke (không phải trình duyệt): `/` 200, `/login` 200, `/orders` → 302 `/login` khi chưa đăng nhập; đăng nhập demo rồi GET `/seller`, `/seller/studio`, `/seller/inbox`, `/seller/products`, `/seller/kb`, `/seller/orders`, `/inbox`, `/orders` đều 200.

### Đã kiểm thử gì / còn cần người dùng click-through

**Đã xác minh bằng lệnh tự động + HTTP (KHÔNG phải kiểm thử trình duyệt):**

| Hạng mục | Bằng chứng |
| --- | --- |
| Thanh toán PENDING → PAID + đúng 1 tin SYSTEM, không cộng dồn khi bấm lần 2, không lộ đơn người khác | `tests/orders-service.test.ts` (6 test, gồm QR content/data URL) |
| Hủy PENDING hoàn kho đúng 1 lần, PAID/SHIPPED không hủy, giao PAID → SHIPPED, chống lẫn shop | `tests/orders-seller.test.ts` (8 test, gồm race hủy) |
| CRUD sản phẩm/upload validate/RAG freshness khi đổi tên-SKU | `tests/products-service.test.ts` (40 test) |
| CRUD KB + RAG freshness sau sửa/xoá | `tests/kb-service.test.ts` (23 test) |
| Định nghĩa Dashboard (doanh thu `paidAt != null`, đếm theo `createdAt`, biên ngày VN 7d/30d, top SP, AI stats, seed trace đọc được) | `tests/dashboard-service.test.ts`, `tests/seed-history.test.ts`, `tests/chat-stats.test.ts` |
| Toàn bộ hồi quy Plan 1/2 (Aho-Corasick, reminder, takeover, socket) | `npm test`: 28 file / 286 passed + 1 skipped |
| Build/lint/typecheck | `npm run build` PASS; `npm run lint` sạch; `npx tsc --noEmit` sạch |
| Các trang trả HTML đúng guard và heading | HTTP smoke ở trên (200/302) |

**⚠️ Chưa xác minh trình duyệt — cần người dùng click-through trước buổi bảo vệ:**

1. **Hai cửa sổ thật** (thường + ẩn danh), đăng nhập nhanh, webcam/mic và quyền camera của trình duyệt.
2. `SP01 2 cái` trong live: highlight + dòng `⚡ Bắt SKU 0,x ms → tạo Đơn #X` + toast ở **cả hai** cửa sổ; log engine ở Studio.
3. `/orders`: **ảnh QR hiển thị đúng**, nút **Giả lập đã chuyển khoản** → PAID ngay, banner đổi trạng thái, `paidAt` hiện.
4. Tin SYSTEM thanh toán xuất hiện realtime ở **Inbox khách** và **Inbox shop**, hội thoại shop **nhảy lên đầu**.
5. Popup **Live đã kết thúc** và link **📊 Xem Dashboard chi tiết** điều hướng đúng.
6. `/seller/products`: upload ảnh thật (JPG/PNG/WEBP ≤ 2 MB), preview, thử file > 2 MB để thấy lỗi; sửa tên → hỏi AI thấy tên mới.
7. `/seller/kb`: sửa “đổi trả” → hỏi lại trong Inbox thấy câu trả lời mới (RAG freshness trên UI).
8. Dashboard: bấm **Hôm nay / 7 ngày / 30 ngày** thấy số khác nhau, biểu đồ/top SP/AI block render đúng; kiểm tra trên **máy chiếu** (1280×720 và 1920×1080, zoom 100%, nav seller có xuống dòng gọn không).
9. Takeover: banner **“Nhân viên shop đã tiếp quản”** hiện phía khách, AI im, **↩︎ Trả lời cho AI** hoạt động.
10. Chống lẫn shop: mở hội thoại shop 2 từ Trang chủ, hỏi `SP01 giá bao nhiêu?` → 200.000đ / đổi trả 3 ngày.

> **Máy mới:** chưa có điều kiện xác minh tuyệt đối trên một máy sạch trong phiên này (⚠️). Quy trình `docker compose up -d` → `npm install` → `prisma migrate` + `seed` → `npm run dev` đã được chạy lại **từ trạng thái seed trên máy hiện tại**; người dùng nên thử lại trên máy demo thật trước buổi bảo vệ.

## 15. Xử lý sự cố nhanh

| Triệu chứng | Cách xử lý |
| --- | --- |
| `docker compose up -d` báo port 5433 bận | Tắt container/project khác đang giữ 5433 (`docker ps`), hoặc đổi map port trong `docker-compose.yml` **và** `DATABASE_URL`/`TEST_DATABASE_URL` cho khớp. |
| `npm test` báo `TEST_DATABASE_URL is not set` | Chưa có `.env` — copy từ `.env.example`. |
| `npm test` lỗi kết nối / migrate vào `liveorder_test` | Docker chưa chạy hoặc container chưa lên: `docker compose up -d` rồi chạy lại. |
| `npm run build` lỗi kết nối DB | `.env` chưa có hoặc DB chưa chạy — bật Docker rồi build lại. |
| Camera không mở ở Studio | Webcam chỉ chạy ở `http://localhost` hoặc HTTPS (không chạy qua IP LAN `http://`), cần cấp quyền camera cho trình duyệt và không để app khác giữ webcam. Studio vẫn dùng được khi không có camera. |
| Upload ảnh lỗi | Kiểm tra file JPG/PNG/WEBP ≤ 2 MB và thư mục `public/uploads/` ghi được; serverless read-only không hỗ trợ upload. |
| Nút **Giả lập đã chuyển khoản** báo 403 | `DEMO_MODE` đang khác `true` — bật trong `.env` rồi khởi động lại server. |
| `npm run seed` báo lỗi unique | Dữ liệu cũ lệch id: `npx prisma migrate reset` (xoá sạch DB dev) rồi `npm run seed`. |
| Lỗi import `generated/prisma` sau khi clone | `npx prisma generate` (thường đã tự chạy ở `npm install`). |
| Port 3000 bận | Đổi `PORT` trong `.env` và mở lại đúng port mới. |
| AI Inbox không trả lời (tin xin lỗi / fallback) | Kiểm `GROQ_API_KEY` trong `.env`; nếu 404 model_not_found → đổi `GROQ_MODEL` sang model key đang mở. Xem chi tiết ngay trong app: phía khách bật **🛠 Kỹ thuật**, phía shop mở khối **"Vì sao AI trả lời thế này?"** để đọc `model`/`error`. |
| Câu hỏi đầu tiên bị chậm vài chục giây | Lần đầu đang tải model embedding ~113 MB vào `.cache/transformers/` (cần internet một lần). Các lần sau chỉ ~vài giây. |
| Không thấy tin nhắc thanh toán | Mặc định nhắc sau **5 phút** kể từ lúc chốt đơn; kết thúc live sẽ nhắc ngay các đơn còn PENDING. Muốn thấy liền khi demo: `PAYMENT_REMIND_DELAY_MS=2000` trước khi chạy server. Mỗi đơn chỉ nhắc **1 lần**. |
| Muốn reset dữ liệu demo | `npx prisma migrate reset` (xoá toàn bộ) + `npm run seed`; hoặc chỉ `npm run seed` để khôi phục giá/kho/tên seed (đơn cũ và sản phẩm/KB tự thêm vẫn giữ). |
