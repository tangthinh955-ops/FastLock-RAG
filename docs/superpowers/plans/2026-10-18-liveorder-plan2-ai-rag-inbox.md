# LiveOrder Plan 2 — AI/RAG tư vấn 24/7 (Inbox) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Xây cốt lõi ② — Inbox riêng của khách/shop với trợ lý AI RAG (embedding local `multilingual-e5-small` + Groq) trả lời dựa trên KB + sản phẩm thật của đúng shop, takeover người thật luôn thắng máy, tra đơn, nhắc thanh toán, chip nguồn + truy vết RAG.

**Architecture:** Một namespace socket.io `/inbox` mới (custom server sẵn có) đi kèm REST-less server components đọc DB cho render lần đầu. Pipeline AI: buyer gửi tin → lưu `DirectMessage(BUYER)` → retrieve top-k từ **index RAM theo shop** (embedding local, invalidate khi KB/product đổi) → dựng prompt (KB + giá/kho đọc sống từ DB + ngữ cảnh live + lịch sử) → Groq chat completions (timeout, fallback full-KB) → kiểm tra lại `mode/version` trước khi lưu/phát (takeover thắng). Câu hỏi về đơn đi đường template xác định (không qua Groq). Nhắc thanh toán bằng timer trong process + `dedupKey`.

**Tech Stack:** Next.js 16.4.2 + React 19 + Tailwind v4 (đang có), Prisma 7 (đang có), socket.io (đang có), `@huggingface/transformers@^4.3.1` (**thư viện mới duy nhất**, spec §4 đã chỉ định), Groq qua `fetch` (không SDK).

**Spec:** `docs/superpowers/specs/2026-10-16-liveorder-nextjs-demo-design.md` (thẩm quyền khi xung đột) — §4 stack, §5.3/§5.10 màn hình, §6 schema, §7 bất biến, §8.1–8.6 cơ chế, §10 kịch bản demo, §12 nghiệm thu. Kèm `docs/superpowers/spikes/2026-10-18-m1-embedding-spike.md` (kết quả chốt model).

## Global Constraints

- **UI tiếng Việt 100%**; mọi số tiền `Int` VND; giờ đêm theo `Asia/Ho_Chi_Minh`.
- **Danh tính chỉ từ JWT** (HTTP + socket); payload client (`buyerId`, `shopId`, `room`…) bị bỏ qua hoàn toàn.
- **AI CHỈ trong Inbox riêng** — không bao giờ tự trả lời comment livestream (spec §7.3).
- **Embedding 100% local** — không dịch vụ embedding ngoài (spec §4); không thêm thư viện khác ngoài `@huggingface/transformers` (Groq gọi bằng `fetch`).
- **Ngày/giờ**: `createdAt` lưu UTC; tính "đêm 22h–6h" bằng `Intl.DateTimeFormat` với `timeZone: "Asia/Ho_Chi_Minh"`.
- **Không che SĐT trong Inbox** — che chỉ áp cho kênh công khai livestream (spec §7.2 "trước khi broadcast ra kênh công khai"); ghi 1 comment ở service.
- **`npm test` không được cần mạng/model**: mọi test dùng fake embedder/Groq; integration thật opt-in qua `RAG_INTEGRATION=1` (skipped mặc định).
- **Next 16**: trang đọc cookie/DB thêm `export const instant = false`; route handler bắt lỗi guard phải `unstable_rethrow(error)` (R17); mọi state sống chung giữa các bundle đi qua `globalThis` (R18/R19).
- **Model embedding (chốt bởi spike):** `Xenova/multilingual-e5-small`, revision `761b726dd34fb83930e26aab4e9ac3899aa1fa78`, dtype `q8`, 384 chiều, tiền tố `query: `/`passage: ` BẮT BUỘC.
- **Cache model:** `.cache/transformers/` trong repo (gitignore); lần đầu cần internet (~113 MB) — README ghi rõ.
- **Groq model qua env `GROQ_MODEL`** (mặc định `qwen/qwen3-32b`), không hard-code; `GROQ_API_KEY` đã có trong `.env`.
- **Commit sau mỗi task**, message tiếng Việt theo mẫu plan; báo cáo task ghi vào workspace SDD (`.superpowers/`, không commit).

## Review Focus

1. **Rò rỉ đơn của người khác**: khách hỏi mã đơn không thuộc mình → chỉ được trả "không thấy trong đơn của bạn", tuyệt đối không lộ mã/SP/số tiền của buyer khác (test ở Task 5, Task 7).
2. **Takeover thắng máy kể cả khi AI đang bay**: seller tiếp quản đúng lúc AI chưa trả xong → kết quả AI bị **hủy im lặng** (không lưu, không phát) (test ở Task 6, Task 7).
3. **Nhắc thanh toán đúng-một-lần**: timer 5 phút + hook end-live + retry không tạo 2 tin; đơn đã PAID thì không nhắc (test ở Task 8).
4. **Không lẫn shop**: chat với shop A nhắc SKU trùng mã của shop B → chỉ tra/trả dữ liệu shop A (test ở Task 5).
5. **Gửi lặp (retry/nonce) không nhân đôi tin**: cùng `clientNonce` gửi lại → 1 message lưu DB (test ở Task 6, Task 7).

---

## Quyết định đã chốt (đọc trước khi làm)

- **Schema thêm 1 cột:** `DirectMessage.trace Json?` — lưu truy vết RAG của tin AI (model, topK, sản phẩm+giá lúc trả lời, tokens, thời gian, fallback?). Không thêm bảng.
- **Index RAM theo shop** trong `lib/rag/index.ts`, cache `globalThis` (bài học R18: Next tách bundle — REST/server.ts/gateway là các instance module khác nhau). Invalidate: `invalidateShopIndex(shopId)` gọi sau mọi thay đổi KB/product (Plan 3 CRUD sẽ gọi hàm này).
- **Vector KB** = `passage: {title}\n{answer}`; **vector Product** = `passage: Sản phẩm {name} (mã {sku})` — **giá/kho KHÔNG vào vector**, đọc sống từ DB lúc dựng prompt (spec §4).
- **SKU nhắc rõ trong câu hỏi** (`/\bSP\d{2}\b/i`) → tra **chính xác** `(shopId, sku)` chứ không dùng cosine (spec §7.5).
- **Câu hỏi về đơn** (regex `/#\s*\d+/`, "đơn", "thanh toán", "chuyển khoản", "giao chưa") → trả lời **template xác định** từ DB (không qua Groq) để luôn đúng trạng thái; trace ghi `orderLookup`.
- **Dây B:** LiveSession không có quan hệ với Product trong schema → prompt ghi "shop đang lên sóng ({title})" + danh sách sản phẩm của shop (spec §8.3 tinh thần: AI biết shop đang live và mời vào live chốt).
- **Fallback khi Groq lỗi/timeout:** tin AI gồm lời xin lỗi ngắn + **toàn bộ KB của đúng shop** (spec §4), trace `fallback: "FULL_KB"` + `error`.
- **Nhắc thanh toán** (dây A): 5 phút sau khi đơn PENDING được tạo (nếu có hội thoại — chưa có thì tạo) + ngay khi live kết thúc nếu đơn còn PENDING; `dedupKey = order:{id}:remind`; nội dung có mã đơn/SP/số tiền/hạn giữ hàng, QR thuộc Plan 3 (ghi "QR ở mục Đơn của tôi — Plan 3").
- **Người mua vào Inbox:** GET `/inbox?shop={id}` tạo-or-lấy hội thoại rồi render (idempotent nhờ unique `[buyerId, shopId]`); seller vẫn vào `/seller/inbox`.
- **"AI đang trả lời…"** là sự kiện socket `ai_thinking` (bật khi bắt đầu gọi, tắt trong `finally`) — có tắt cả khi bị hủy do takeover.
- **Ngoài phạm vi Plan 2** (Plan 3 làm): `/orders` + QR + nút "Giả lập đã chuyển khoản", CRUD `/seller/products` `/seller/kb` `/seller/orders`, Dashboard, popup tổng kết → Dashboard, seed trace cho tin AI lịch sử (UI hiện "tin cũ — không có truy vết").

### Cấu trúc file (tạo mới ➕ / sửa ✏️)

```
lib/rag/embedder.ts        ➕ nạp model e5 lazy singleton + tiền tố e5 + buildEmbedText()
lib/rag/index.ts           ➕ index RAM theo shop, retrieve top-k, findExactSku, invalidate
lib/rag/groq.ts            ➕ chatCompletion() fetch + timeout + GroqError
lib/chat/ai.ts             ➕ buildPrompt(), createAiRunner() (order template, RAG, fallback)
lib/chat/service.ts        ➕ getOrCreateConversation, appendMessage, sellerSend, handBack, list/get
lib/chat/flow.ts           ➕ handleBuyerMessage / handleSellerMessage / handleHandBack + emit
lib/chat/reminders.ts      ➕ timer 5' + end-live + dedupKey
lib/chat/stats.ts          ➕ countAiConversationsAtNight (dây C)
lib/chat/gateway.ts        ➕ namespace /inbox: auth, join_conversation, send_message, hand_back_to_ai
hooks/useInboxSocket.ts    ➕ socket + state cho cả 2 màn hình
components/inbox/*.tsx     ➕ InboxClient (buyer), SellerInboxClient (seller), bubbles/chips dùng chung
app/inbox/page.tsx         ✏️ placeholder → Inbox khách thật
app/seller/inbox/page.tsx  ➕ Inbox seller
app/layout.tsx/HomeHeader ✏️ link Inbox cho buyer
components/home/ShopCard  ✏️ nút "💬 Nhắn tin" cho shop offline (spec §5.1, T12 Plan 1 hoãn lại)
components/live/ConsultButton ✏️ trỏ /inbox?shop=...
lib/socket-registry.ts     ✏️ INBOX_NAMESPACE + setInboxIo/getInboxIo (globalThis) + room helpers
server.ts                  ✏️ attachInboxGateway + setInboxIo
lib/live/gateway.ts        ✏️ sau khi tạo đơn thành công → schedulePaymentReminder(order.id)
lib/live/sessions.ts       ✏️ endLive → remindPendingOrdersForSession(sessionId)
prisma/schema.prisma       ✏️ DirectMessage.trace Json?
.env.example/.gitignore/README ✏️ GROQ_MODEL, .cache/transformers/, mục Inbox
tests/rag-*.test.ts, tests/chat-*.test.ts ➕
```

---

### Task 1: Schema `trace` + env + gitignore

**Files:**
- Modify: `prisma/schema.prisma` (model `DirectMessage`), `.env.example`, `.gitignore`
- Create: migration `prisma/migrations/*_direct_message_trace/migration.sql` (do `npx prisma migrate dev` sinh)
- Test: `tests/chat-schema.test.ts`

**Interfaces:**
- Produces: `DirectMessage.trace` (nullable `Json`) để Task 4/5/9 dùng.

- [ ] **Step 1: Failing test** — `tests/chat-schema.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { testPrisma, resetDb } from "./helpers/db";

describe("DirectMessage.trace", () => {
  it("lưu và đọc lại JSON trace", async () => {
    // dựng user/shop/conversation tối thiểu bằng testPrisma (đủ field bắt buộc của schema),
    // tạo DirectMessage source AI với trace = { model: "qwen/qwen3-32b", fallback: null }
    // expect message.trace đọc lại deep-equal object đã lưu
  });
});
```
(Test này compile-fail vì `trace` chưa có trong type generated.)

- [ ] **Step 2: Run** `npx prisma migrate dev --name direct_message_trace` sau khi thêm
  `trace Json?` vào `DirectMessage`; `npx prisma generate`; chạy `npx vitest run tests/chat-schema.test.ts` → PASS.
- [ ] **Step 3: Env + gitignore**: `.env.example` thêm `GROQ_MODEL=qwen/qwen3-32b` (kèm comment "đổi theo model Groq đang mở"); `.gitignore` thêm `.cache/`.
- [ ] **Step 4: Full check** `npx tsc --noEmit && npm test` (không vỡ test cũ) → PASS.
- [ ] **Step 5: Commit** `feat: schema trace cho tin AI + env GROQ_MODEL + cache model gitignore`.

---

### Task 2: Embedder local (e5-small)

**Files:**
- Create: `lib/rag/embedder.ts`
- Modify: `package.json` (`npm install @huggingface/transformers@^4.3.1`)
- Test: `tests/rag-embedder.test.ts`

**Interfaces:**
- Produces:
```ts
export const EMBEDDING_MODEL_ID = "Xenova/multilingual-e5-small";
export const EMBEDDING_MODEL_REVISION = "761b726dd34fb83930e26aab4e9ac3899aa1fa78";
export const EMBEDDING_DIM = 384;
export type EmbedKind = "query" | "passage";
export interface Embedder { embed(texts: readonly string[], kind: EmbedKind): Promise<number[][]>; }
export function buildEmbedText(text: string, kind: EmbedKind): string; // "query: x" | "passage: x"
export function getEmbedder(): Embedder; // lazy singleton globalThis.__ragEmbedder, env.cacheDir = "<cwd>/.cache/transformers"
```
- Consumes: không.

- [ ] **Step 1: Failing test** — `tests/rag-embedder.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { buildEmbedText, EMBEDDING_DIM, getEmbedder } from "@/lib/rag/embedder";

describe("rag/embedder", () => {
  it("buildEmbedText thêm tiền tố đúng cho e5", () => {
    expect(buildEmbedText("xin chào", "query")).toBe("query: xin chào");
    expect(buildEmbedText("xin chào", "passage")).toBe("passage: xin chào");
  });
  it.runIf(process.env.RAG_INTEGRATION === "1")("model thật trả vector 384 chiều", async () => {
    const [v] = await getEmbedder().embed(["1m68 62kg mặc size gì"], "query");
    expect(v).toHaveLength(EMBEDDING_DIM);
  });
});
```

- [ ] **Step 2: Run** `npx vitest run tests/rag-embedder.test.ts` → PASS với 1 test (integration skipped).
- [ ] **Step 3: Implement** `lib/rag/embedder.ts`: import `env, pipeline` từ `@huggingface/transformers`; `env.cacheDir` set **trước** lần `pipeline()` đầu; singleton qua `globalThis.__ragEmbedder` (pattern R18, comment lý do); `embed()` gọi `pipeline(texts.map(buildEmbedText), { pooling: "mean", normalize: true, dtype: "q8" })` → `output.tolist()`. Chạy `npm install @huggingface/transformers` (ghi version vào package.json).
- [ ] **Step 4: Run lại test** → PASS; `npx tsc --noEmit` sạch.
- [ ] **Step 5: (tuỳ chọn, có mạng)** `RAG_INTEGRATION=1 npx vitest run tests/rag-embedder.test.ts` → PASS thật (tải model ~113 MB vào `.cache/transformers`).
- [ ] **Step 6: Commit** `feat: embedder local multilingual-e5-small (spike M1)`.

---

### Task 3: Index RAM theo shop + retrieve

**Files:**
- Create: `lib/rag/index.ts`
- Test: `tests/rag-index.test.ts`

**Interfaces:**
- Consumes: `Embedder`, `buildEmbedText` (Task 2).
- Produces:
```ts
export type IndexEntryKind = "kb" | "product";
export type RetrievedEntry = { id: string; kind: IndexEntryKind; title: string; sku?: string; score: number };
export type ShopIndexMeta = { shopId: string; builtAt: string; modelId: string; revision: string; kbCount: number; productCount: number };
export async function retrieve(prisma: PrismaClient, shopId: string, query: string, opts?: { topK?: number; embedder?: Embedder }): Promise<{ entries: RetrievedEntry[]; meta: ShopIndexMeta }>;
export async function findExactSku(prisma: PrismaClient, shopId: string, sku: string): Promise<Product | null>; // sku được upper-case trước khi tra
export function invalidateShopIndex(shopId: string): void;
export function invalidateAllShopIndexes(): void; // dùng trong test
```
- Nội bộ: `globalThis.__ragShopIndexes: Map<shopId, { meta, entries, vectors }>`; dựng lazy trong `retrieve` nếu chưa có; KB query `title` + `answer`, product text `Sản phẩm {name} (mã {sku})`; cosine trên vector đã normalize; sort giảm dần, cắt `topK ?? 5`.

- [ ] **Step 1: Failing tests** — `tests/rag-index.test.ts` (fake embedder: vector 384 chiều suy ra từ chữ cái đầu của `text` — ví dụ chiều thứ `i` = 1 nếu text chứa ký tự mapped, đảm bảo xác định và có thể so sánh ranking):
  - `retrieve trả KB đúng shop` — seed 2 shop có KB khác nhau (dùng `testPrisma` + dữ liệu tối thiểu), query khớp shop A → entry của A, không có entry của B.
  - `product text KHÔNG chứa giá/kho` — đổi `price`/`stock` trong DB rồi `invalidateShopIndex` + `retrieve` lại → `meta.builtAt` đổi nhưng kết quả vẫn đúng (và test riêng assert rằng text nội bộ không chứa chuỗi giá — export `__getShopIndexForTest(shopId)` chỉ trong test hoặc assert qua `meta.productCount`).
  - `invalidate ép dựng lại` — thêm KB mới trực tiếp vào DB → `retrieve` (chưa invalidate) không thấy; gọi `invalidateShopIndex` → `retrieve` thấy.
  - `findExactSku("sp01")` trả đúng sản phẩm shop đó (case-insensitive), shop khác trả null.
- [ ] **Step 2: Run** `npx vitest run tests/rag-index.test.ts` → FAIL (module chưa có).
- [ ] **Step 3: Implement** `lib/rag/index.ts` theo interface trên.
- [ ] **Step 4: Run** → PASS; `npx tsc --noEmit`.
- [ ] **Step 5: Commit** `feat: index RAG theo shop (retrieve top-k, exact SKU, invalidate)`.

---

### Task 4: Groq client (fetch + timeout)

**Files:**
- Create: `lib/rag/groq.ts`
- Test: `tests/rag-groq.test.ts`

**Interfaces:**
- Produces:
```ts
export const DEFAULT_GROQ_MODEL = "qwen/qwen3-32b";
export type GroqMessage = { role: "system" | "user" | "assistant"; content: string };
export type GroqResult = { content: string; model: string; promptTokens: number; completionTokens: number; elapsedMs: number };
export class GroqError extends Error { readonly status?: number; }
export async function chatCompletion(messages: GroqMessage[], opts?: { model?: string; timeoutMs?: number; fetchImpl?: typeof fetch }): Promise<GroqResult>;
// POST https://api.groq.com/openai/v1/chat/completions, Authorization: Bearer GROQ_API_KEY
// model = opts.model ?? process.env.GROQ_MODEL ?? DEFAULT_GROQ_MODEL; timeout mặc định 20_000ms (AbortController)
```
- Lỗi: thiếu key → `GroqError("GROQ_API_KEY chưa được cấu hình")`; HTTP !ok → `GroqError` kèm `status` + message tiếng Việt ngắn; abort → `GroqError("Groq quá thời gian chờ")`.

- [ ] **Step 1: Failing tests** — `tests/rag-groq.test.ts` với `fetchImpl` giả:
  - thành công: trả `content` + tokens từ JSON giả, `elapsedMs >= 0`;
  - HTTP 401: `rejects.toBeInstanceOf(GroqError)` + `status === 401`;
  - timeout: fetchImpl trả promise không bao giờ resolve nhưng tôn trọng `signal` → expect reject "quá thời gian" (dùng `timeoutMs: 50`);
  - thiếu key: `delete process.env.GROQ_API_KEY` → reject đúng message (khôi phục env sau test).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** `lib/rag/groq.ts`.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: (có mạng + key thật) Manual smoke một lần:** script `tsx` ngoài repo gọi `chatCompletion([{role:"user",content:"chào bạn"}])` → in model + tokens. **Nếu 400 model không tồn tại:** `curl -s https://api.groq.com/openai/v1/models -H "Authorization: Bearer $GROQ_API_KEY"` chọn model Qwen đang mở, cập nhật `DEFAULT_GROQ_MODEL` + `.env.example`, ghi report.
- [ ] **Step 6: Commit** `feat: groq client chat completions (timeout, lỗi tiếng Việt)`.

---

### Task 5: AI runner (prompt + order template + fallback)

**Files:**
- Create: `lib/chat/ai.ts`
- Test: `tests/chat-ai.test.ts`

**Interfaces:**
- Consumes: `retrieve`, `findExactSku` (T3); `chatCompletion`, `GroqError` (T4).
- Produces:
```ts
export type AiTrace = {
  model: string;
  topK: { id: string; title: string; kind: IndexEntryKind; score: number }[];
  products: { sku: string; name: string; price: number; stock: number }[];
  liveSessionId?: string;
  orderLookup?: { code: number; status: string; total: number };
  tokens: { prompt: number; completion: number };
  elapsedMs: number;
  fallback?: "FULL_KB";
  error?: string;
};
export type AiAnswer = { content: string; trace: AiTrace };
export type AiRunnerInput = { conversationId: string; shopId: string; buyerId: string; text: string; history: { source: string; content: string }[] };
export type AiRunner = { answer(prisma: PrismaClient, input: AiRunnerInput): Promise<AiAnswer> };
export function readTrace(value: unknown): AiTrace | null; // validate tối thiểu cho UI đọc từ JSON
export function buildPrompt(input: { shopName: string; live: { title: string } | null; kb: { title: string; answer: string }[]; products: { sku: string; name: string; price: number; stock: number }[]; history: { source: string; content: string }[]; question: string }): GroqMessage[];
export function createAiRunner(deps?: { chatCompletion?: typeof chatCompletion }): AiRunner;
```
- Hành vi bắt buộc:
  - `isOrderQuestion(text)` → tra `order.findMany({ where: { buyerId, shopId }, orderBy: { code: "desc" } })`; nếu có `/#\s*(\d+)/` thì lọc đúng code **của buyer đó**; trả template: có đơn → "Đơn #code — {tên SP} ×qty — {tổng}đ — trạng thái {PENDING→'chờ thanh toán' | PAID 'đã thanh toán' | SHIPPED 'đang giao' | CANCELLED 'đã hủy'}" + (PENDING: "bạn vào Đơn của tôi để quét QR (Plan 3)") ; không có → "Mình chưa thấy đơn nào của bạn ở shop này."; không bao giờ trả đơn buyer khác (query đã scope buyerId).
  - RAG: `retrieve(prisma, shopId, text)`, nếu text chứa `/\bSP\d{2}\b/i` → `findExactSku`; dựng `buildPrompt` với KB top-k (title+answer), **toàn bộ** products của shop (giá/kho đọc lúc này), live session hiện tại (nếu có); gọi `chatCompletion`; lỗi/timeout → fallback full-KB: content = xin lỗi ngắn + toàn bộ KB (title + answer) + nhắc nhắn lại; `trace.fallback = "FULL_KB"`, `trace.error`.
  - Prompt system (tiếng Việt) ghi rõ: chỉ dùng ngữ cảnh; không bịa giá/kho/chính sách; nếu ngoài ngữ cảnh thì nói chưa có thông tin và mời để lại câu hỏi; nếu shop đang live thì mời vào xem/chốt; xưng "mình", gọi khách "bạn"; trả lời ngắn gọn.
- Test (fake `chatCompletion` + KB/Product seed tối thiểu):
  - hỏi "đơn của mình sao rồi" với 1 đơn PENDING của buyer → content chứa `#code` + "chờ thanh toán"; `trace.orderLookup` đúng.
  - hỏi mã đơn của **buyer khác** (`#999` thuộc người khác) → content "chưa thấy đơn" và **không chứa** tổng tiền của đơn kia.
  - chat với shop A nhắc `SP01` → trace.products chỉ chứa SP01 của **shop A** (giá khác shop B — assert đúng giá A).
  - Groq throw → content chứa lời xin lỗi + **đủ** title của toàn bộ KB shop A; trace.fallback = "FULL_KB".
  - prompt có "đang lên sóng" khi shop có live session LIVE.

- [ ] **Step 1: Failing tests** như trên → **Step 2: Run** FAIL → **Step 3: Implement** → **Step 4: Run** PASS + `npx tsc --noEmit` → **Step 5: Commit** `feat: AI runner RAG + tra đơn + fallback KB`.

---

### Task 6: Chat service (persistence, takeover, version)

**Files:**
- Create: `lib/chat/service.ts`
- Test: `tests/chat-service.test.ts`

**Interfaces:**
- Produces:
```ts
export type ChatPrisma = PrismaClient;
export async function getOrCreateConversation(prisma: ChatPrisma, buyerId: string, shopId: string): Promise<Conversation>;
export async function appendMessage(prisma: ChatPrisma, input: { conversationId: string; source: MessageSource; content: string; dedupKey?: string; orderId?: string; trace?: Prisma.InputJsonValue }): Promise<DirectMessage | null>; // null khi dedupKey trùng (P2002)
export async function sellerSendMessage(prisma: ChatPrisma, input: { conversationId: string; sellerShopId: string; content: string }): Promise<{ message: DirectMessage; conversation: Conversation }>; // transaction: chặn sai shop (throw ApiError 403 style), mode=HUMAN + version+1, tạo message SELLER
export async function handBackToAi(prisma: ChatPrisma, input: { conversationId: string; sellerShopId: string }): Promise<Conversation>; // mode=AI + version+1
export async function listBuyerConversations(prisma: ChatPrisma, buyerId: string): Promise<ConversationListItem[]>;
export async function listShopConversations(prisma: ChatPrisma, shopId: string): Promise<ConversationListItem[]>;
export type ConversationListItem = { conversation: Conversation; shop?: { id: string; name: string }; buyer?: { id: string; name: string }; lastMessage: DirectMessage | null };
export async function getMessages(prisma: ChatPrisma, conversationId: string, opts?: { take?: number }): Promise<DirectMessage[]>;
```
- `ApiError` dùng lại `lib/auth/service.ts` (đã có: `new ApiError(403, msg)`).
- Ghi chú trong file: **không che SĐT ở Inbox** (spec §7.2 chỉ áp kênh công khai).

- [ ] **Step 1: Failing tests**:
  - `getOrCreateConversation` gọi 2 lần → cùng id, chỉ 1 row (unique buyer+shop).
  - `appendMessage` với `dedupKey` trùng → lần 2 trả `null`, DB vẫn 1 tin.
  - `sellerSendMessage` → conversation.mode HUMAN, version tăng 1, message source SELLER; seller shop khác → throw (không đổi state).
  - `handBackToAi` → mode AI, version +1.
- [ ] **Step 2–4:** Run FAIL → implement → Run PASS + tsc.
- [ ] **Step 5: Commit** `feat: chat service (hội thoại, takeover version, dedup)`.

---

### Task 7: Socket namespace `/inbox` + orchestration flow

**Files:**
- Create: `lib/chat/flow.ts`, `lib/chat/gateway.ts`
- Modify: `lib/socket-registry.ts` (thêm `INBOX_NAMESPACE = "/inbox"`, `conversationRoom(id)`, `shopInboxRoom(shopId)`, `setInboxIo/getInboxIo` qua `globalThis.__inboxIo`), `server.ts` (attach + set + log)
- Test: `tests/chat-gateway.test.ts`

**Interfaces:**
- Produces:
```ts
export type InboxMessageEvent = { message: { id: string; conversationId: string; source: MessageSource; content: string; orderId?: string; trace?: unknown; createdAt: string } };
export type InboxConversationEvent = { conversationId: string; mode: ChatMode; version: number };
export type InboxAiThinkingEvent = { conversationId: string; thinking: boolean };
export type InboxErrorEvent = { conversationId?: string; message: string };
export function attachInboxGateway(io: Server, prisma: PrismaClient, deps?: { aiRunner?: AiRunner }): void;
// flow.ts:
export async function handleBuyerMessage(deps: { prisma: PrismaClient; io: Server; aiRunner?: AiRunner }, input: { conversation: Conversation; buyerId: string; text: string; clientNonce?: string }): Promise<void>;
export async function handleSellerMessage(deps: { prisma: PrismaClient; io: Server }, input: { conversationId: string; sellerShopId: string; content: string }): Promise<void>;
export async function handleHandBackToAi(deps: { prisma: PrismaClient; io: Server }, input: { conversationId: string; sellerShopId: string }): Promise<void>;
```
- Quy tắc (bất biến):
  - Auth handshake: `auth.token` → `verifyToken` → `socket.data.user`; role SELLER → tra `shop` theo `ownerId` (401/403 nếu không có).
  - `join_conversation {conversationId}`: BUYER phải là chủ hội thoại; SELLER thuộc shop của hội thoại; sai → `inbox_error` riêng cho socket đó. OK → join `conversation:{id}`; SELLER còn join thêm `shop:{shopId}` khi connect.
  - `send_message {conversationId, content, clientNonce?}`: validate content (trim 1..2000) — sai → `inbox_error`. BUYER → `handleBuyerMessage`; SELLER → `handleSellerMessage`.
  - `handleBuyerMessage`: (1) `appendMessage(BUYER, dedupKey = clientNonce ? \`msg:{conversationId}:{clientNonce}\` : undefined)`; null (trùng) → dừng im lặng; (2) emit `message` vào `conversation:{id}`; (3) nếu `mode === "AI"`: emit `ai_thinking true`; chạy `aiRunner.answer(prisma, {...history 20 tin cuối})`; **đọc lại conversation**; nếu `mode !== "AI"` hoặc `version !== versionLúcBắtĐầu` → **hủy im lặng** (không lưu/không phát) + `ai_thinking false`; ngược lại `appendMessage(AI, content, trace)` + emit; lỗi bất ngờ → tin AI xin lỗi ngắn (append + emit, trace.error), `finally` luôn `ai_thinking false`.
  - `handleSellerMessage`: `sellerSendMessage` → emit `message` + `conversation_updated` (mode HUMAN, version mới) vào `conversation` + `shop` room.
  - `handleHandBackToAi`: `handBackToAi` → emit `conversation_updated` (mode AI, version mới).
- Test (dựng `http` + `Server` in-process, client thật `socket.io-client`, `aiRunner` giả có thể chậm để test race — mirror `tests/live-gateway.test.ts`):
  - không token → connect bị từ chối; buyer join hội thoại người khác → `inbox_error`.
  - buyer gửi tin → cả 2 client trong room nhận `message`; gửi lại cùng `clientNonce` → không có message thứ hai.
  - **race takeover**: fake aiRunner chờ; seller gửi tin (takeover) rồi resolve aiRunner → **không** có tin AI nào được lưu/phát; `conversation_updated` mode HUMAN.
  - seller gửi tin xong → `hand_back_to_ai` → mode AI; buyer gửi tiếp → AI trả lời (fake) được.
- [ ] **Step 1–5 TDD** như trên; cuối cùng `npx tsc --noEmit && npm test` → **Commit** `feat: socket inbox + flow AI/takeover (hủy im lặng khi race)`.

---

### Task 8: Nhắc thanh toán (dây A) + hook end-live

**Files:**
- Create: `lib/chat/reminders.ts`
- Modify: `lib/live/gateway.ts` (sau khi order tạo thành công: `schedulePaymentReminder(order.id, order.buyerId, session.shopId)`), `lib/live/sessions.ts` (cuối `endLive`: `remindPendingOrdersForSession(sessionId)`)
- Test: `tests/chat-reminders.test.ts`

**Interfaces:**
- Produces:
```ts
export const PAYMENT_REMIND_DELAY_MS = 5 * 60_000;
export function schedulePaymentReminder(orderId: string, buyerId: string, shopId: string, deps?: ReminderDeps): void;
export async function remindPendingOrdersForSession(sessionId: string, deps?: ReminderDeps): Promise<number>; // trả số đơn đã nhắc (test)
export type ReminderDeps = { prisma?: PrismaClient; delayMs?: number; emit?: (event: InboxMessageEvent, conversationId: string, shopId: string) => void };
// timer lưu globalThis.__liveReminders (Map orderId→timer, R18) — clear khi fire.
// Nội dung: "⏰ Đơn #{code} ({tên SP} ×{qty} — {total}đ) vẫn đang chờ thanh toán. ... QR ở mục Đơn của tôi (Plan 3)."
// dedupKey = `order:{orderId}:remind`; trước khi gửi đọc lại order — status !== PENDING → dừng.
```
- [ ] **Step 1: Failing tests** (vitest fake timers + deps inject):
  - schedule delay 100ms → sau khi tiến đồng hồ: đúng 1 message SYSTEM, dedupKey đúng; chạy lại `schedulePaymentReminder` cùng đơn + fire → vẫn 1 tin trong DB.
  - order đã PAID trước khi timer fire → không có tin.
  - `remindPendingOrdersForSession`: 2 đơn PENDING + 1 PAID thuộc session → trả 2, DB có 2 tin SYSTEM; gọi lại lần 2 → trả 0 (dedup).
- [ ] **Step 2–4:** FAIL → implement → PASS + tsc.
- [ ] **Step 5: Commit** `feat: nhắc thanh toán 5' + hook end-live (1 lần/đơn)`.

---

### Task 9: Trang `/inbox` của khách + hook socket

**Files:**
- Create: `hooks/useInboxSocket.ts`, `components/inbox/InboxChat.tsx` (bong bóng + chip nguồn + block truy vết + toggle 🛠), `components/inbox/InboxClient.tsx` (layout 2 cột)
- Modify: `app/inbox/page.tsx` (placeholder → thật), `components/home/HomeHeader.tsx` (link "💬 Inbox" cho BUYER)
- Test: manual + `npx tsc`, build; (logic hiển thị thuần UI — không unit test riêng, smoke ở Task 12)

**Interfaces:**
- Consumes: `listBuyerConversations`, `getMessages`, `getOrCreateConversation` (T6); `readTrace`, `AiTrace` (T5); `InboxMessageEvent`, `InboxConversationEvent`, `InboxAiThinkingEvent`, `InboxErrorEvent` (T7).
- `page.tsx` (server): `requireUser("BUYER")`; `searchParams.shop` → `getOrCreateConversation` rồi lấy messages; không có `shop` → hội thoại mới nhất (hoặc màn hình trống "Chọn shop để bắt đầu"); `export const instant = false`; truyền `token` (cookie) xuống client như `/live` (spec §4 sanction).
- `useInboxSocket(token)`: connect `/inbox` ns + `auth.token`; `join_conversation` theo id đang mở; state `messages` (append + `seq` client như bài học T14), `mode`, `aiThinking`, `error`, `connected`; `sendMessage(content)` sinh `clientNonce = crypto.randomUUID()`; cleanup disconnect.
- UI khách: danh sách hội thoại trái (tên shop, tin cuối, thời gian, badge `HUMAN` khi đã takeover); khung chat phải; tin AI có **chip nguồn** (chip xám: mỗi product `🛍 SP01 · Áo thun` — giá hiện tại; mỗi KB `📚 {title}`; nếu trace null → "tin cũ — không có truy vết"); **công tắc 🛠 Kỹ thuật** (localStorage `inbox.tech`) hiện khối chi tiết: model, topK + điểm, giá/kho đọc lúc trả lời, tokens, ms, fallback/error; banner vàng "🔔 Nhân viên shop đã tiếp quản — AI tạm dừng" khi mode HUMAN; dòng "🤖 AI đang trả lời…" theo `aiThinking`; tin SYSTEM nổi giữa (thanh toán/nhắc); thẻ đơn nhỏ khi message có `orderId` (link `/orders` disable + nhãn "Plan 3").
- [ ] **Step 1:** viết hook + components + page (code thật theo interface) — **Step 2:** `npx tsc --noEmit` sạch — **Step 3:** chạy dev tay: mở `/inbox` (chưa có hội thoại → empty state), `/inbox?shop={id}` → hội thoại mới hiện — **Step 4: Commit** `feat: inbox khách (chat, chip nguồn, truy vết RAG, takeover banner)`.

---

### Task 10: Inbox seller `/seller/inbox` + badge đêm (dây C)

**Files:**
- Create: `app/seller/inbox/page.tsx`, `components/inbox/SellerInboxClient.tsx`, `lib/chat/stats.ts`
- Test: `tests/chat-stats.test.ts` (đếm đêm) + manual smoke

**Interfaces:**
- Produces: `export async function countAiConversationsAtNight(prisma: PrismaClient, shopId: string): Promise<number>` — đếm **số hội thoại khác nhau** có ≥1 tin `source=AI` với giờ VN trong `[22:00, 06:00)`.
- `page.tsx`: `requireUser("SELLER")`; tra shop theo ownerId (như studio); `instant = false`; data: `listShopConversations`, `countAiConversationsAtNight`, messages hội thoại đầu.
- `SellerInboxClient`: giống InboxClient + ô trả lời (gửi → takeover), nút **"↩︎ Trả lời cho AI"** khi mode HUMAN, khối **"Vì sao AI trả lời thế này?"** luôn hiện dưới mỗi tin AI (chip + topK + điểm + tokens + ms + model + fallback), badge **"🌙 AI đã xử lý {N} hội thoại trong đêm (22h–6h)"**; tin của khách/SYSTEM hiển thị đủ.
- [ ] **Step 1: Failing test** stats: seed 3 hội thoại, AI messages lúc 23:00 VN + 03:00 VN + 12:00 VN (cùng shop) → count = 2; shop khác = 0. → **Step 2** FAIL → **Step 3** implement → **Step 4** PASS + tsc → **Step 5** dev smoke `/seller/inbox` 200 với cookie seller → **Step 6: Commit** `feat: inbox seller (takeover, vì-sao-AI, badge đêm)`.

---

### Task 11: Điểm vào — Nhắn tin từ Trang chủ + Tư vấn từ Live

**Files:**
- Modify: `components/home/ShopCard.tsx` (offline: thêm CTA `💬 Nhắn tin` → `/inbox?shop={id}`), `components/live/ViewerClient.tsx` + `components/live/ConsultButton.tsx` (Tư vấn → `/inbox?shop={shopId}`, đổi prop), `components/home/HomeHeader.tsx` nếu cần đồng bộ link.
- Test: manual + curls.

- [ ] **Step 1:** sửa 3 component (link + prop `shopId` cho ConsultButton; ShopCard nhận thêm prop `href`/`shopId` nếu cần — giữ đúng pattern hiện có). Không phá layout card (CTA `mt-auto` sẵn có).
- [ ] **Step 2:** `npx tsc --noEmit && npm run lint` sạch; curl `/` → HTML có "Nhắn tin" cho shop offline; `/live/{id}` → link Tư vấn chứa `/inbox?shop=`.
- [ ] **Step 3: Commit** `feat: điểm vào inbox từ trang chủ và trang live`.

---

### Task 12: README + kiểm tra tổng + smoke kịch bản §10 (phần Plan 2)

**Files:**
- Modify: `README.md` (thêm mục Inbox: GROQ_MODEL, model tải lần đầu ~113 MB vào `.cache/transformers`, kịch bản AI 24/7, takeover, tra đơn, nhắc thanh toán; cập nhật trạng thái Plan 2 ✅ / Plan 3 là bước tiếp)
- Report: `.superpowers/sdd/<plan2-workspace>/task-12-report.md` (không commit)

- [ ] **Step 1: Full checks** `npm run lint`, `npx tsc --noEmit`, `npm test` (không mạng), `npm run build` → PASS hết.
- [ ] **Step 2: Smoke CLI 2 phiên** (2 cookie jar + socket.io-client thật, script ngoài repo, xoá sau):
  - seller1 start live; buyer1 demo-login → `/inbox?shop={linh}` 200 (hội thoại tạo);
  - buyer gửi "1m68 62kg mặc size gì?" → nhận `message` AI thật từ Groq + trace.topK trỏ `kb-linh-size`; **kiểm tra chéo DB**: `DirectMessage.trace` có model/tokens;
  - buyer hỏi "đơn của mình sao rồi" → template đúng trạng thái đơn thật;
  - seller join `/seller/inbox` socket → gửi tin trả lời → buyer nhận `conversation_updated` HUMAN + banner; buyer hỏi tiếp → **không có tin AI mới** trong 10s; seller `hand_back_to_ai` → buyer hỏi lại → AI trả lời;
  - tạo đơn PENDING mới trong live → chờ (hoặc rút `PAYMENT_REMIND_DELAY_MS` bằng biến test) → đúng 1 tin SYSTEM nhắc; `endLive` với 1 đơn PENDING → nhắc ngay, không lặp;
  - chống lẫn shop: hội thoại shop 2 hỏi "SP01 giá bao nhiêu" → giá 200.000đ của Bảo An (không phải 150.000đ của Linh).
- [ ] **Step 3: Nghiệm thu §12 (phần Plan 2)** — tick + evidence: không lẫn shop (KB/giá theo shop, kể cả shop offline); AI trả lời khi offline; takeover im + "Trả lời cho AI"; chip nguồn + Truy vết + công tắc 🛠; tra đơn đúng/không rò; nhắc 1 lần/đơn + sau PAID không nhắc (PAID test bằng cập nhật DB trực tiếp — UI giả lập thuộc Plan 3); SĐT che (Plan 1) giữ nguyên; **ghi rõ mục chưa browser-verify** (bong bóng UI, toggle, banner, cuộn) cho người dùng click tay.
- [ ] **Step 4: Commit** `docs: README mục Inbox + chốt Plan 2`.

---

## Ghi chú cho người thực thi

- Thứ tự task là phụ thuộc; đừng nhảy. Task 2 cần mạng **một lần** để tải model vào `.cache/transformers` (đã có sẵn từ spike nếu copy cache — không bắt buộc).
- Embedding/Groq thật trong test bị cấm: luôn inject fake. `RAG_INTEGRATION=1` chỉ để chạy tay.
- Mọi emit từ REST (nhắc đơn, SYSTEM) phải qua `getInboxIo()` (globalThis) — không `let` module.
- Giữ nguyên các bất biến Plan 1 (`requireUser` + `unstable_rethrow`, `instant = false`, không tin payload).
- Cuối plan: báo người dùng để (a) review Plan 3 đề xuất (Dashboard + quản lý + đóng gói) và (b) chốt có chạy thêm vòng polish UI nào không.
