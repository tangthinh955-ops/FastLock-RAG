# LiveOrder Demo (Next.js) — Bản thiết kế

- **Ngày:** 16/10/2026
- **Trạng thái:** Chờ người dùng duyệt (đã qua một vòng phản biện độc lập — xem mục 3.1)
- **Thư mục dự án:** `C:\NAM4_2\fastlock_openCode`
- **Nguồn bối cảnh:** Kế hoạch đồ án LiveOrder (bản chính tại `C:\NAM4_2\fastlock_demo`) + các buổi chốt với người dùng ngày 16/10/2026 (xem mục 3 "các quyết định đã chốt").

---

## 1. Ý tưởng & mục đích

LiveOrder là đồ án tốt nghiệp: nền tảng **bán hàng qua livestream**. Bản chính của đồ án đang được làm ở một project khác (NestJS + React/Vite). **Bản này là một demo độc lập viết bằng Next.js**, mục đích:

1. Có **một bản chạy trọn vẹn, đẹp, để trình diễn** trước hội đồng — thay vì trông chờ bản chính đang hoàn thiện dần.
2. **Làm nổi bật rõ 2 cốt lõi** của đồ án:
   - **① Thuật toán bắt comment → chốt đơn:** khách gõ mã sản phẩm trong comment livestream, hệ thống tự bóc mã (Aho-Corasick), tạo đơn và trừ kho nguyên tử.
   - **② RAG tư vấn 24/7:** AI trong Inbox riêng trả lời khách dựa trên kiến thức của shop + sản phẩm thật (giá/kho đọc live từ DB), tiếp quản bởi người bán khi cần.
3. Là **bàn thử nghiệm** cho các ý tưởng trước khi đưa vào bản chính (ví dụ: cơ chế truy vết RAG, dây nối AI ↔ phiên live).

Người dùng bản demo: **Buyer** (khách mua) và **Seller** (chủ shop). Giao diện tiếng Việt. Demo chạy trên **một máy, hai cửa sổ trình duyệt độc lập** (một cửa sổ thường + một ẩn danh, hoặc hai trình duyệt khác nhau) — vì phiên đăng nhập nằm trong cookie `httpOnly` dùng chung cho mọi tab cùng profile (quyết định B1, mục 3.1).

---

## 2. Mục tiêu, ngoài phạm vi, tiêu chí "thất bại"

### Goals
- Chạy được toàn bộ vòng: mở live → khách xem, comment chốt đơn → AI tư vấn (kể cả ngoài giờ) → nhắc thanh toán → thanh toán (giả lập) → quản lý đơn → tổng kết Dashboard.
- Hai cốt lõi phải **nhìn thấy được bằng mắt** khi trình diễn: highlight mã SKU bắt được + dòng log tốc độ; chip nguồn + khối "Truy vết RAG" sau công tắc 🔍.
- Kịch bản demo chạy trơn tru trong ~10 phút, có sẵn dữ liệu, đăng nhập nhanh, không thao tác DB tay.

### Non-goals (KHÔNG làm trong bản này)
- Webhook ngân hàng thật / xác nhận thanh toán thật (thanh toán là **giả lập**, xem mục 8.6).
- Truyền video qua mạng (WebRTC/RTMP). Webcam chỉ hiện **cục bộ trong Studio của seller**; tab khách chiếu placeholder/video mẫu + badge LIVE.
- Thanh toán nhiều đơn cộng dồn, hoàn tiền, đối soát ngân hàng.
- Admin panel, quản lý người dùng, phân quyền phức tạp (chỉ 2 vai trò BUYER/SELLER).
- Deploy cloud, CI/CD, Docker hóa app (Docker **chỉ dùng cho Postgres**).
- Bộ đo A/B hoàn chỉnh như kế hoạch S19 của bản chính — bản demo chỉ giữ khối truy vết + log để có thể thử.
- Mobile app / responsive hoàn hảo cho điện thoại (ưu tiên desktop vì demo bằng laptop/projector).

### Anti-goals (làm ra thế này là SAI)
- AI trả lời tự động trên comment công khai của livestream (tốn quota, sai thiết kế — AI chỉ trong Inbox riêng).
- Lộ SĐT khách chưa che trên kênh công khai.
- Giá/kho trả lời từ vector hoặc từ trí nhớ AI thay vì đọc DB lúc trả lời.
- Lẫn dữ liệu giữa 2 shop (sản phẩm trùng mã SP01 nhưng 2 shop khác nhau).
- Sidebar/UI bịa số liệu: mọi con số trên Dashboard phải đọc từ DB.

---

## 3. Các quyết định đã chốt với người dùng (16/10/2026)

| # | Quyết định | Nguồn |
|---|---|---|
| 1 | Toàn bộ làm bằng **Next.js + React** (một app duy nhất) | Người dùng |
| 2 | Bố cục màn khách xem live: **kiểu TikTok** — chat nổi trên video (chat nền tối, SKU highlight đậm để đọc rõ) | Người dùng chọn B |
| 3 | **Truy vết RAG đặt phía Seller** (khối "Vì sao AI trả lời thế này?"); phía khách chỉ có chip nguồn nhẹ; kèm **công tắc 🔍 Kỹ thuật** để phô pipeline lúc bảo vệ | Người dùng chọn A |
| 4 | **AI có tra cứu đơn hàng** ("Đơn #12 tới đâu rồi?") cho chính khách đang chat | Người dùng chọn A |
| 5 | Ba "dây nối" AI ↔ live: **A** nhắc thanh toán đơn từ live, **B** AI biết sản phẩm đang lên sóng, **C** trực đêm + tóm tắt "AI đã xử lý N hội thoại trong đêm". Người dùng chốt A + C; B giữ luôn vì chi phí thấp (có thể bỏ nếu phát sinh) | Người dùng |
| 6 | Bộ câu hỏi demo gồm 3 nhóm: hỏi khi xem live (SP/giá/size/ship), hỏi ngay sau chốt đơn (tra đơn, nhắc thanh toán), **hậu mãi khi shop offline** (đổi size, hàng lỗi, địa chỉ đổi trả) | Người dùng |
| 7 | KB seed: bảng size, đổi trả 7 ngày, hàng lỗi & bảo hành, vận chuyển & phí, cách chốt đơn qua live, khuyến mãi — kèm catalog ~8 SP | Người dùng đồng ý |
| 8 | Seller **kết thúc live → popup tổng kết nhanh** ("12 đơn · 2.450.000đ") rồi mới sang Dashboard | Mặc định của thiết kế, người dùng không phản đối |
| 9 | Dashboard seller có thêm khối **"Hiệu quả AI"** (hội thoại AI trả lời, hội thoại đêm, tốc độ, câu hỏi phổ biến) | Người dùng chọn A |
| 10 | **Thanh toán giả lập**: hiện QR + nút "giả lập đã chuyển khoản" → đơn PAID; webhook thật để phiên bản sau | Người dùng đồng ý |
| 11 | Key Groq để trong `.env`, người dùng tự điền | Người dùng |
| 12 | Tài khoản demo seed sẵn + nút **"Đăng nhập nhanh"** (Khách/Shop) cho lúc bảo vệ | Thiết kế đề xuất, người dùng không phản đối |
| 13 | Seed **2 shop** có sản phẩm trùng mã (SP01) nhưng giá/KB khác nhau → demo chống lẫn shop | Thiết kế đề xuất, người dùng đồng ý chủ đề |

### 3.1. Quyết định bổ sung do người viết thiết kế chốt (nhờ người dùng rà khi đọc)

Một người phản biện độc lập đã đọc bản thiết kế và nêu 4 điểm; tất cả đã được xử lý và ghi lại dưới đây:

| # | Quyết định | Lý do |
|---|---|---|
| B1 | Demo dùng **2 cửa sổ trình duyệt độc lập** (thường + ẩn danh, hoặc 2 trình duyệt) thay vì 2 tab cùng profile | Cookie JWT `httpOnly` dùng chung cho mọi tab cùng profile — đăng nhập nhanh ở cửa sổ này sẽ "cướp" phiên của cửa sổ kia. Không đổi cơ chế auth, chỉ đổi hướng dẫn chạy demo. |
| B2 | Thêm nút **"Trả lại cho AI"** trong `/seller/inbox` (`mode` HUMAN → AI, `version++`) | Takeover mặc định vẫn ở lại HUMAN (nhất quán thiết kế bản chính); nút này giúp kịch bản linh hoạt và cứu được lúc tập thử bấm nhầm. |
| B3 | **Sửa thứ tự kịch bản demo**: các bước hỏi AI (size, hậu mãi, tra đơn) diễn ra **trước**; seller tiếp quản gần cuối | Tránh mâu thuẫn "takeover rồi mà AI còn trả lời" trong cùng một hội thoại. |
| B4 | Trang chủ hiện **cả shop offline** kèm nút **"💬 Nhắn tin"** mở hội thoại | Kịch bản chống lẫn shop cần hội thoại với shop 2 dù shop 2 không mở live; cũng hợp lý với câu chuyện "AI trực khi shop offline". |
| B5 | Seed kèm **lịch sử quá khứ** (hội thoại/tin nhắn rải 7–30 ngày, ≥2 hội thoại khung 22h–6h, 1–2 phiên live cũ kèm đơn) | Dashboard mở lên là có số ngay; bộ lọc Hôm nay/7/30 ngày và badge "hội thoại trong đêm" có ý nghĩa khi demo ban ngày. Mọi con số vẫn đọc từ DB (seed là dữ liệu DB hợp lệ). |

---

## 4. Kiến trúc & stack

- **Một app Next.js 15 (App Router) + TypeScript**, UI **Tailwind CSS**. Không monorepo, không workspace — một `package.json` duy nhất.
- **Realtime:** `socket.io` gắn vào Next.js qua **custom server** (`server.ts` chạy bằng `tsx` khi dev, build production chạy `node`). Hai namespace:
  - `/live` — comment công khai + sự kiện đơn nổ.
  - `/inbox` — tin nhắn riêng + AI.
  - Xác thực bằng **JWT lấy từ handshake**; danh tính LUÔN lấy từ token, không bao giờ tin payload.
  - Lưu ý kỹ thuật: custom server + Next 15 có thể xung đột với Turbopack — dùng chế độ webpack (`next dev` không `--turbo`) nếu cần.
- **DB:** PostgreSQL chạy bằng `docker-compose.yml` (chỉ service `postgres`, volume bền) + **Prisma**. Tiền tệ dùng **Int (VND)**.
- **Auth:** JWT trong cookie `httpOnly`; 2 role `BUYER`/`SELLER`; đăng ký mới → BUYER; tài khoản seller seed sẵn. Endpoint `POST /api/auth/demo-login` (chỉ bật khi `DEMO_MODE=true`) cho nút đăng nhập nhanh.
- **Thuật toán:** module Aho-Corasick viết tay bằng TypeScript, chạy server-side; trả về mã khớp + **vị trí khớp trong chuỗi** (để client highlight) + thời gian chạy (ms). Word-boundary: `SP01` không khớp trong `SP010`. Chỉ dùng SKU của đúng shop đang live.
- **Embedding local:** `@huggingface/transformers` (Transformers.js), cache model xuống đĩa (thư mục cố định trong repo, gitignore), chạy CPU. **Model chốt sau bước đo M1** — ứng viên: `Xenova/multilingual-e5-small` (384d) hoặc `Xenova/paraphrase-multilingual-MiniLM-L12-v2`; lưu `model id + revision` trong metadata của index.
- **Vector store:** **giữ trong RAM** (Map trong process) — không thêm cột DB, không dịch vụ ngoài. Embed bù theo lô khi retrieve lần đầu cho một shop; index vô hiệu/embed lại khi KbEntry hoặc tên/SKU Product đổi/xóa. Giá/kho KHÔNG nằm trong vector.
- **Sinh câu trả lời:** Groq API (chat completions), model đặt qua env `GROQ_MODEL` (mặc định một model Qwen theo kế hoạch). Có timeout; lỗi/timeout → fallback full-KB của đúng shop; không áp dụng fallback cho câu hỏi ngoài dữ liệu (AI phải hỏi lại hoặc nói không có thông tin).
- **QR:** thư viện `qrcode` render ảnh QR từ chuỗi kiểu VietQR với thông tin ngân hàng demo (không phải tài khoản thật). Nội dung QR kèm mã thanh toán duy nhất của đơn.

### Không dùng
- Không DB vector chuyên dụng (pgvector, Qdrant...) — ngoài phạm vi.
- Không gọi embedding qua dịch vụ ngoài — embedding 100% local.
- Không dùng bất kỳ thư viện nào tự ý thêm nặng (nếu cần thì sẽ hỏi trước).

---

## 5. Màn hình (đã phác thảo và duyệt)

Layout chung: header mảnh có logo, tên shop/tài khoản, vai trò, nút đăng xuất. Font hệ thống, tông sáng, accent xanh.

### Buyer
1. **`/` Trang chủ** — danh sách shop: shop đang live lên đầu (badge `● LIVE`, bấm vào xem live); **shop offline vẫn hiện** kèm nút **`💬 Nhắn tin`** mở hội thoại với shop (phục vụ kịch bản shop 2 + câu chuyện "AI trực khi shop offline").
2. **`/live/[id]` Xem live (kiểu TikTok)** — video (placeholder/video mẫu) làm nền; badge `● LIVE · 👀 N`; **chat overlay nền tối** phía dưới-trái; ô nhập comment dưới cùng; nút `💬 Tư vấn` góc trên phải; khi comment khớp SKU: **highlight đúng đoạn mã** trên bong bóng + dòng hệ thống `⚡ Đã tạo Đơn #X — ... · ⏱ n ms` + toast `✅ Chốt đơn #X`; thẻ nhỏ "📦 Đơn của bạn" ở góc; comment chứa SĐT đã bị che (`0912***678`).
3. **`/inbox` Inbox của khách** — danh sách hội thoại (trái) + khung chat (phải). Tin AI có **chip nguồn** (`🛍️ SP01 · cập nhật lúc trả lời`, `📚 KB: …`). **Công tắc `🔍 Kỹ thuật`** (giữa tắt): khi bật, dưới mỗi tin AI hiện khối **Truy vết RAG** (câu hỏi → top-k + điểm khớp → token/thời gian Groq). Banner `🧑‍💼 … đã tiếp quản — AI tạm dừng` khi seller gõ. Tin SYSTEM (thanh toán, nhắc tiền) nảy trong khung này.
4. **`/orders` Đơn của tôi** — danh sách đơn kèm trạng thái; chi tiết đơn có QR + nút **"Giả lập đã chuyển khoản"** (chỉ DEMO_MODE).

### Seller
5. **`/seller/studio` Studio** — webcam preview cục bộ (getUserMedia) + tiêu đề live + nút `■ Kết thúc live`; panel phải: **comment realtime** (highlight giống khách) + **đơn nổ realtime** (đơn mới viền sáng, trạng thái tiền); dải log dưới webcam: `⚙️ Aho-Corasick theo dõi N mã SKU · log: … bắt "SP01" → Đơn #12 · 0,4 ms` + nhãn `🔍 Kỹ thuật`. Kết thúc live → **popup tổng kết nhanh** ("12 đơn · 2.450.000đ") + nút sang Dashboard. Có nút phụ **"giả lập khách comment"** (chỉ demo).
6. **`/seller` Dashboard** — filter thời gian (Hôm nay · 7 ngày · 30 ngày); 4 thẻ KPI: **Doanh thu thực thu (chỉ đơn PAID)**, Đơn theo trạng thái (PAID/Chờ/Hủy), SP đã bán, Đỉnh người xem; **biểu đồ doanh thu theo giờ**; **Top 5 SP bán chạy**; khối **"Hiệu quả AI"**: số hội thoại AI trả lời, số hội thoại đêm (22h–6h), thời gian trả lời trung bình, câu hỏi phổ biến.
7. **`/seller/products`** — bảng CRUD sản phẩm: ảnh, tên, SKU, giá, kho. Upload ảnh lưu local `public/uploads` (đơn giản, không cloud).
8. **`/seller/kb`** — CRUD kiến thức AI (keyword/tiêu đề + câu trả lời). Sửa KB → lần hỏi sau AI trả lời khác ngay (demo RAG).
9. **`/seller/orders`** — danh sách đơn của shop; hành động: xác nhận/giao (PAID → SHIPPED), hủy (chỉ khi PENDING, **hoàn kho cùng transaction**).
10. **`/seller/inbox`** — danh sách hội thoại + khung trả lời khách; **khối "Vì sao AI trả lời thế này?"** dưới mỗi tin AI (nguồn dùng, điểm khớp, giá/kho đọc lúc nào, model/token/thời gian); gõ tay → takeover (banner xuất hiện phía khách) và nút **"Trả lại cho AI"** (xem mục 7.4); badge **"AI đã xử lý N hội thoại trong đêm"**.

### Auth
11. **`/login`, `/register`** — form cơ bản + validate; trên `/login` có **2 nút đăng nhập nhanh**: `👤 Khách demo` / `🏪 Shop demo`.

---

## 6. Dữ liệu (Prisma — tên/chi tiết cuối do người thực thi chốt)

> Tiền: `Int` (VND). Mọi model có `id` UUID. Seed dùng **UUID cố định** (hằng số) để re-seed không gãy quan hệ.

- **User**: `email`, `passwordHash`, `name`, `role` (`BUYER`|`SELLER`). Seller gắn shop 1-1.
- **Shop**: `name`, `avatarUrl?`, `ownerId` (user seller). (Giản lược — không tách bank info trong bản demo: QR dùng thông tin ngân hàng demo trong env.)
- **Product**: `shopId`, `sku` (unique theo shop), `name`, `price` Int, `stock` Int, `imageUrl?`.
- **KbEntry**: `shopId`, `title`, `answer` (nội dung dài), `updatedAt`. Embed `title + answer`.
- **LiveSession**: `shopId`, `title`, `status` (`LIVE`|`ENDED`), `startedAt`, `endedAt?`, `peakViewers` Int (số giả lập để UI có dữ liệu).
- **Conversation**: `buyerId`, `shopId`, `mode` (`AI`|`HUMAN`), `version` Int (`@default(1)`), `updatedAt`. Unique `[buyerId, shopId]`.
- **DirectMessage**: `conversationId`, `source` (`BUYER`|`SELLER`|`AI`|`SYSTEM`), `content`, `dedupKey` String? `@unique` (chống trùng tin SYSTEM/AI), `orderId?`, `createdAt`.
- **Order**: `shopId`, `buyerId`, `productId`, `qty` Int, `unitPrice` Int (snapshot), `total` Int, `status` (`PENDING`|`PAID`|`SHIPPED`|`CANCELLED`), `eventId` String `@unique` (chống trùng khi retry), `paymentCode` String `@unique` (mã thanh toán cho QR), `paidAt?`, `liveSessionId?`, `createdAt`.
- **Bảng phụ trợ cho Dashboard "Hiệu quả AI"**: có thể suy trực tiếp từ `DirectMessage` (đếm source=AI, giờ tạo…) — **không cần bảng riêng**; nếu hiệu năng seed ổn thì giữ cách này.

Ràng buộc quan trọng:
- Trừ kho: `UPDATE "Product" SET stock = stock - $qty WHERE id=$id AND stock >= $qty` trong transaction cùng lúc tạo Order — atomic chống oversell.
- Hủy đơn (PENDING): cộng lại kho + đổi trạng thái **cùng transaction**.
- `eventId` sinh server-side từ (liveSessionId + comment id/socket event id + userId + SKU) để comment retry không tạo đơn đúp.

---

## 7. Cơ chế cốt lõi (bất biến — không được vi phạm)

1. **Danh tính** (HTTP + Socket): luôn lấy từ JWT; payload client gửi lên (`buyerId`, `room`) chỉ là gợi ý, server bỏ qua.
2. **Che SĐT server-side** trước khi broadcast ra kênh công khai: regex SĐT VN → `0912***678`. Người gửi (nếu là buyer đã đăng nhập) có thể thấy phần che; seller trong Studio cũng thấy bản che (nhất quán).
3. **AI chỉ trong Inbox riêng** — không tự động gọi AI cho comment livestream.
4. **Takeover:** seller gõ tay ⇒ `mode=HUMAN` + `version++` trong cùng transaction; khi AI sinh xong phải kiểm tra lại `mode/version` trước khi lưu/phát; lệch ⇒ **hủy im lặng** (không lưu, không phát). Seller có nút **"Trả lại cho AI"** ⇒ `mode=AI` + `version++` (cùng transaction) — AI tư vấn trở lại từ tin kế tiếp.
5. **RAG đúng shop:** mọi truy vấn KB/Product filter `shopId`; SKU nêu rõ trong câu hỏi phải kiểm tra **chính xác** trong shop đó — không thay bằng sản phẩm gần giống qua cosine. Giá/kho chỉ đọc từ DB lúc dựng prompt.
6. **Chống trùng:** `eventId` cho Order; `dedupKey` cho DirectMessage hệ thống (`order:{id}:paid`, `order:{id}:remind`…).
7. **Aho-Corasick + word-boundary:** so khớp trên ranh giới từ; trả vị trí khớp để highlight; đo thời gian thực thi (ms, hiển thị trên log UI).
8. **Không lẫn shop trong demo 2 shop:** shop B có SP01 riêng — hỏi shop nào trả lời theo shop đó cả giá, kho, lẫn điều khoản KB.
9. **Seed UUID cố định.**
10. **Tiền đến/đi không tự bịa:** Dashboard chỉ tính `PAID`; hủy đơn hoàn kho không tạo giao dịch tiền.

---

## 8. Các tính năng đặc thù của bản demo

### 8.1. Hai cốt lõi "nhìn thấy được"
- ① trên **Xem live + Studio**: highlight vị trí mã khớp trong comment, dòng trạng thái có **số ms thật**, toast đơn nổ, panel đơn realtime.
- ② trên **Inbox**: chip nguồn mỗi tin AI; **Truy vết RAG** (ẩn sau công tắc 🔍 ở phía khách; hiện mặc định trong khối "Vì sao AI trả lời thế này?" ở phía seller).

### 8.2. Dây A — nhắc thanh toán
- Trigger gợi ý: 5 phút sau khi đơn PENDING được tạo mà chưa PAID **và** người mua đang có hội thoại với shop (hoặc ngay khi live kết thúc nếu đơn chưa trả). Nội dung: mã đơn, SP, số tiền, hạn giữ hàng, kèm QR. `dedupKey=order:{id}:remind`; sau khi PAID không nhắc nữa.

### 8.3. Dây B — AI biết sản phẩm đang lên sóng
- Prompt của AI có ngữ cảnh: các sản phẩm thuộc live đang `LIVE` của shop. Khi khách hỏi về SP đang live → AI nói được "đang lên sóng trong livestream lúc này" và mời vào live để chốt.

### 8.4. Dây C — trực đêm + tóm tắt
- AI trả lời mọi lúc (không cần shop online); badge **"AI đã xử lý N hội thoại trong đêm (22h–6h)"** ở seller inbox + khối Hiệu quả AI trên Dashboard. Không hứa phản hồi tức thì thay người bán; nội dung AI luôn ghi rõ là trợ lý của shop.

### 8.5. Tra cứu đơn trong chat
- AI nhận diện câu hỏi về đơn ("đơn #12 tới đâu rồi", "mình chuyển khoản rồi") → truy vấn Order **của đúng buyer đang chat**; trả về mã, SP, trạng thái, số tiền; nếu chưa PAID thì kèm QR/nhắc. Không bao giờ lộ đơn của buyer khác.

### 8.6. Thanh toán giả lập
- Đơn PENDING hiển thị QR (chuỗi VietQR demo + mã `paymentCode`) + nút **"Giả lập đã chuyển khoản"** (chỉ khi `DEMO_MODE=true`) → server chuyển PAID trong transaction + tạo DirectMessage SYSTEM (`order:{id}:paid`) + phát socket. Đây là đường **duy nhất** để PAID trong demo.

### 8.7. Trợ giúp trình diễn
- **Giả lập khách:** khi live mở, server tự đẩy comment mẫu theo kịch bản (có thể bật/tắt) để khung chat sinh động; nút "giả lập khách comment" trong Studio.
- **Đăng nhập nhanh** 2 nút (chỉ DEMO_MODE).
- **Công tắc 🔍 Kỹ thuật** cho lúc bảo vệ.
- **Popup tổng kết** sau khi kết thúc live.

---

## 9. Nội dung seed (đề xuất — chỉnh được)

**Shop 1 — "Shop Thời Trang Linh"** (shop chính của demo):

| SKU | Tên | Giá | Kho | Ghi chú |
|---|---|---|---|---|
| SP01 | Áo thun basic | 150.000 | 8 | SP chủ đạo kịch bản |
| SP02 | Quần jogger | 220.000 | 5 | |
| SP03 | Nón bucket | 120.000 | 10 | |
| SP04 | Quần short jean | 260.000 | 4 | |
| SP05 | Áo polo | 150.000 | 6 | |
| SP06 | Áo khoác gió | 320.000 | 3 | để demo cháy hàng |
| SP07 | Túi tote | 120.000 | 12 | |

**KB Shop 1** (6 entries): Bảng size (gợi ý theo chiều cao/cân nặng) · Chính sách đổi trả 7 ngày (đổi size: khách chịu phí ship; lỗi shop: shop chịu) · Hàng lỗi & bảo hành (gửi ảnh trong 48h, đổi mới) · Vận chuyển & phí (nội thành 1 ngày, tỉnh 2–4 ngày; **freeship đơn từ 300.000đ trong giờ live**) · Cách chốt đơn qua livestream (gõ "mã SP + số lượng" trong comment) · Khuyến mãi đang chạy (freeship ≥300k trong live 20–22h).

**Shop 2 — "Shop Áo Sơ Mi Bảo An"** (để test chống lẫn shop): cũng có sản phẩm mã **SP01** nhưng là "Áo sơ mi công sở" — 200.000đ, kho 5 — và KB khác hẳn (đổi trả 3 ngày, phí ship khác). Chỉ cần 2–3 sản phẩm + 2–3 KB entries.

**Tài khoản seed:** `khach@demo.vn` (BUYER), `linh@demo.vn` (SELLER shop 1), `baoan@demo.vn` (SELLER shop 2) — mật khẩu demo đơn giản, ghi trong README.

**Lịch sử seed (để Dashboard có số ngay khi mở):** ~5–8 hội thoại rải trong 30 ngày gần đây kèm tin nhắn (trong đó ≥2 hội thoại khung 22h–6h có tin AI trả lời), 2 phiên live đã kết thúc (1 hôm qua, 1 tuần trước) kèm đơn PAID/HỦY tương ứng, vài đơn SHIPPED. Số liệu của buổi demo thật sẽ cộng lên trên nền lịch sử này.

---

## 10. Kịch bản demo chuẩn (~10 phút, cho buổi bảo vệ)

1. **Mở màn:** cửa sổ **Seller** đăng nhập nhanh `🏪 Shop demo` → Studio bấm bắt đầu live; cửa sổ **Khách** (ẩn danh) `👤 Khách demo` → Trang chủ → vào live (comment mẫu đang chảy).
2. **Cốt lõi ① — thuật toán:** Khách gõ `SP01 2 cái` → cả 2 cửa sổ cùng thấy: highlight `SP01`, dòng `⚡ Đã tạo Đơn #X · ⏱ 0,x ms`, toast đơn nổ; Studio: dòng log + đơn realtime.
3. **Cốt lõi ② — RAG:** Khách bấm `💬 Tư vấn` → hỏi "1m68 62kg mặc size gì?" → AI trả lời theo bảng size + chip nguồn; bật `🔍 Kỹ thuật` cho hội đồng xem Truy vết RAG.
4. **Hậu mãi ngoài giờ:** Khách hỏi "mặc chật đổi size được không, phí ai chịu?" → AI trả lời đúng điều khoản (dù shop "offline").
5. **Tra đơn + dây A:** Khách hỏi "đơn của mình sao rồi?" → AI tra đúng đơn chờ thanh toán; Seller kết thúc live → popup tổng kết nhanh; Khách mở `/orders` bấm "Giả lập đã chuyển khoản" → cả 2 cửa sổ nhận tin SYSTEM "Đã thanh toán".
6. **Tổng kết:** Dashboard: doanh thu PAID khớp, biểu đồ dồn vào giờ live, top SP, khối Hiệu quả AI (cả phần lịch sử seed).
7. **Takeover — người thật luôn thắng máy:** Seller gõ trả lời trực tiếp trong Inbox → banner "đã tiếp quản" hiện phía khách; khách hỏi thêm → AI im. (Tùy chọn) Seller bấm **"Trả lại cho AI"** → AI trả lời lại.
8. **Chống lẫn shop:** từ Trang chủ, Khách bấm `💬 Nhắn tin` shop 2 (đang offline) → hỏi "SP01 giá bao nhiêu?" → AI trả lời đúng giá/KB của shop 2.
9. (Nếu hội đồng thích kỹ thuật) chạy tình huống "kho còn 1, hai khách chốt cùng lúc" → chỉ 1 đơn thành công, không âm kho.

---

## 11. Thứ tự thực hiện (theo mốc, không đặt deadline)

- **M1 — Khung + nền:** khởi tạo Next.js + Tailwind; docker-compose Postgres; Prisma schema + seed 2 shop; auth + đăng nhập nhanh; **spike Transformers.js trên máy Windows (đo tải model, RAM, độ trễ, chất lượng tiếng Việt — chọn model)**; chốt cách lưu vector (RAM).
- **M2 — Cốt lõi ①:** custom server + socket `/live`; Studio + webcam; viewer TikTok-style; Aho-Corasick + highlight + log ms; Order + trừ kho atomic; toast + panel đơn; giả lập comment.
- **M3 — Cốt lõi ②:** socket `/inbox`; lưu hội thoại + lịch sử; pipeline embedding local + index RAM + embed bù; retrieval + prompt + Groq + fallback; chip nguồn + Truy vết RAG; takeover + version; tra đơn; dây A/B/C.
- **M4 — Hai đầu còn lại:** `/orders` + thanh toán giả lập + SYSTEM messages; `/seller/products` + `/seller/kb` + ảnh; `/seller/orders` (+ hủy hoàn kho); Dashboard + biểu đồ + khối Hiệu quả AI; popup kết thúc live.
- **M5 — Đóng gói demo:** chạy thử toàn kịch bản mục 10, sửa lỗi, README (cách chạy: docker + seed + dev), dọn seed cho đẹp, đóng gói kịch bản demo giấy.

Giữa các mốc: chạy `build`/`lint` sạch trước khi chuyển mốc; sau mỗi mốc cập nhật cho người dùng biết.

---

## 12. Tiêu chí nghiệm thu bản demo

- [ ] Comment `SP01 2 cái` → đơn tạo đúng shop/sản phẩm, kho trừ đúng, cả 2 phía thấy highlight + log ms + đơn nổ.
- [ ] Kho = 1, hai khách "chốt" đồng thời → chỉ 1 đơn; log ghi nhận không âm kho.
- [ ] Không lẫn shop: 2 shop cùng mã SP01 → giá/kho/KB trả lời đúng theo shop đang chat (kể cả hội thoại với shop offline mở từ Trang chủ).
- [ ] AI trả lời đúng cả khi "shop offline"; takeover → AI im hẳn (không lưu, không phát); nút "Trả lại cho AI" → AI trả lời lại được.
- [ ] Chip nguồn + Truy vết RAG hiển thị; công tắc 🔍 bật/tắt được.
- [ ] Tra đơn đúng trạng thái, không lộ đơn người khác.
- [ ] Nhắc thanh toán chỉ 1 lần/đơn; sau PAID không nhắc; PAID chỉ qua nút giả lập/SYSTEM, không có đường lạc nào khác.
- [ ] Sửa KB/giá → câu trả lời AI đổi theo ngay (không còn dữ liệu cũ).
- [ ] Hủy đơn PENDING → kho cộng lại đúng; đơn PAID không bị hủy trong demo.
- [ ] Dashboard: doanh thu = tổng đơn PAID trong DB (kể cả lịch sử seed); top SP khớp; khối AI có số; bộ lọc Hôm nay/7/30 ngày cho ra số khác nhau.
- [ ] SĐT trong comment hiển thị che.
- [ ] Chạy sạch từ máy mới: `docker compose up -d` → `npm install` → `prisma migrate` + `seed` → `npm run dev` → kịch bản mục 10 chạy hết.
- [ ] README tiếng Việt đủ để người khác tự chạy.

---

## 13. Rủi ro & điều còn để ngỏ (người thực thi giải quyết)

1. **Transformers.js trên Windows (onnxruntime-node)** — chưa test; bước spike M1 phải chạy trước khi cam kết. Nếu vướng, phương án dự phòng: đổi sang model nhỏ hơn, hoặc (chỉ khi bất khả kháng) dùng embedding của Groq/khác — nhưng phải hỏi người dùng vì yêu cầu gốc là embedding local.
2. **Model embedding cụ thể chưa chốt** — chọn sau spike M1 dựa trên chất lượng truy vấn tiếng Việt + dung lượng + độ trễ.
3. **Custom server + Next 15 + socket.io** — cấu hình cần thử sớm ở M2; nếu Turbopack cản trở thì dùng webpack dev server.
4. **Số liệu "0,4 ms" trên UI** — phải là số đo thật lấy từ log, không hard-code.
5. **Lần đầu tải model ~120MB** — cần internet; ghi rõ trong README; cache lại trong repo (gitignore) để buổi demo không phải tải.
6. **Groq rate limit** — có thể bị chặn nếu bấm quá nhanh; thêm thông báo lỗi mềm + fallback KB.
7. **Quy tắc "đơn PAID không hủy"** — chốt giữ nguyên cho demo; hoàn tiền ngoài phạm vi.
8. **Tên model Groq** — để env, không hard-code.

---

## 14. Cấu trúc thư mục dự kiến

```
fastlock_openCode/
├─ app/                    # Next.js App Router (pages + api routes)
│  ├─ (buyer)/             # /, /live/[id], /inbox, /orders
│  ├─ seller/              # /seller, /seller/studio, products, kb, orders, inbox
│  ├─ login, register
│  └─ api/                 # auth, products, orders, kb, chat, demo, ...
├─ components/             # UI dùng chung (chat bubble, order card, ...)
├─ lib/                    # aho-corasick.ts, rag/, groq.ts, mask.ts, auth, prisma client
├─ prisma/                 # schema.prisma, seed.ts
├─ public/                 # ảnh seed, uploads/, video mẫu (nếu có)
├─ server.ts               # custom server (Next + socket.io)
├─ docker-compose.yml      # postgres
├─ docs/superpowers/specs/ # tài liệu này
└─ README.md
```

---

## 15. Những gì thuộc về người thực thi (không cần hỏi lại)

- Tên model embedding/Groq cụ thể, tham số top-k, ngưỡng điểm khớp (chọn bằng thử nghiệm).
- Chi tiết UI nhỏ (màu, spacing, icon) miễn giữ đúng tinh thần các quyết định mục 3.
- Nội dung chữ của comment mẫu, tên hội thoại, thứ tự seed.
- Cấu trúc file cụ thể, tên hàm, cách chia component.
- Cách sinh QR demo (thư viện nào) miễn QR đọc được và kèm mã thanh toán.
- Mã đơn hiển thị dạng `#12` (số thứ tự hiển thị, không phải khóa chính); biểu đồ tự vẽ SVG/CSS (không thêm thư viện chart nặng); chốt đơn khi hết hàng → trả dòng hệ thống "SP đã hết hàng"; reset demo = migrate + seed.
