# Sơ đồ RAG — Inbox AI tư vấn 24/7 (LiveOrder)

> Tài liệu mô tả **đúng pipeline đang chạy trong code** (không phải RAG lý thuyết).
> Nguồn: `lib/rag/*`, `lib/chat/ai.ts`, `lib/chat/flow.ts`, `lib/chat/gateway.ts`.
>
> Cách xem: mở file này bằng **VS Code + extension "Markdown Preview Mermaid Support"**,
> dán vào [mermaid.live](https://mermaid.live) để export PNG/SVG, hoặc đẩy lên GitHub
> (GitHub render Mermaid sẵn). Ảnh chụp từ mermaid.live chèn Word rất tiện.

---

## 1. Sơ đồ tổng quan — 2 giai đoạn: nạp tri thức & truy vấn

```mermaid
flowchart TB
  subgraph OFF["GIAI ĐOẠN 1 — NẠP TRI THỨC (lazy, mỗi shop một index)"]
    direction TB
    KB["Bảng KbEntry<br/>title + answer"] --> TXT["Ghép văn bản để embed<br/>KB: title + answer<br/>SP: 'Sản phẩm tên (mã SKU)'"]
    PR["Bảng Product<br/>name + sku"] --> TXT
    TXT --> EMB["Embedder chạy LOCAL<br/>Xenova/multilingual-e5-small<br/>q8 · 384 chiều · prefix 'passage:'"]
    EMB --> IDX["Vector index trong RAM<br/>Map shopId → entries + vectors<br/>vector đã normalize → cosine = dot"]
    W["Seller thêm/sửa/xoá KB<br/>hoặc tên/SKU sản phẩm"] --> INV["invalidateShopIndex(shopId)"]
    INV -. "lần retrieve kế tiếp dựng lại" .-> TXT
  end

  subgraph ON["GIAI ĐOẠN 2 — TRUY VẤN (mỗi tin nhắn của khách)"]
    direction TB
    MSG["Khách gửi tin trong Inbox<br/>socket /inbox · send_message<br/>JWT + đúng chủ hội thoại"] --> SAVE["Lưu DirectMessage (BUYER)<br/>dedup theo clientNonce"]
    SAVE --> MODE{"Hội thoại<br/>mode = AI?"}
    MODE -- "Không — seller đã tiếp quản" --> STOP["Dừng, AI im lặng"]
    MODE -- "Có" --> Q{"Câu hỏi về đơn?<br/>có #mã hoặc từ khoá<br/>đơn / thanh toán / giao"}
    Q -- "Có" --> TPL["Template xác định từ DB<br/>SELECT Order theo buyerId + shopId<br/>KHÔNG gọi Groq"]
    Q -- "Không" --> RAG["Nhánh RAG"]
    RAG --> QEMB["Embed câu hỏi<br/>prefix 'query:'"]
    QEMB --> SIM["Cosine với toàn bộ vector của shop<br/>sort giảm dần → lấy top-5"]
    SIM --> CTX["Dựng ngữ cảnh<br/>• KB top-5 (đọc lại answer theo id)<br/>• TOÀN BỘ sản phẩm + giá/kho HIỆN TẠI<br/>• SKU chính xác nếu câu hỏi nêu mã<br/>• Phiên live đang mở (nếu có)<br/>• 20 tin gần nhất (BUYER=user, AI/SELLER=assistant)"]
    CTX --> PROMPT["buildPrompt<br/>1 system (vai + quy tắc + NGỮ CẢNH)<br/>+ history + câu hỏi"]
    PROMPT --> GROQ{"Groq Chat Completions<br/>qwen/qwen3.8-27b<br/>timeout 20s"}
    GROQ -- "OK" --> ANSWER["Câu trả lời + trace<br/>model · topK & score · tokens · elapsedMs"]
    GROQ -- "GroqError: thiếu key / HTTP lỗi / quá hạn" --> FALL["Fallback FULL_KB<br/>xin lỗi + TOÀN BỘ KB của shop<br/>trace fallback = FULL_KB + error"]
    TPL --> SAVED
    ANSWER --> SAVED["Lưu DirectMessage (AI)<br/>source = AI · trace JSON"]
    FALL --> SAVED
    SAVED --> EMIT["Phát socket 'message'<br/>realtime tới cả 2 cửa sổ"]
    EMIT --> UI["UI: bubble AI + chip nguồn top-5<br/>+ nút 'Vì sao AI trả lời' (trace)"]
  end

  IDX --> SIM
```

### Điểm cốt lõi cần nói khi bảo vệ

- **Index tách theo từng shop**: `retrieve` chỉ trả entry của đúng `shopId` → không lẫn tri thức shop khác.
- **Giá/kho KHÔNG nằm trong vector**: chỉ tên/SKU sản phẩm được embed; giá/kho đọc từ DB **ngay lúc dựng prompt** → luôn đúng, đổi giá không cần đánh lại index.
- **SKU nêu rõ được tra chính xác** (`findExactSku`), không thay bằng sản phẩm "gần giống" qua cosine.
- **Câu hỏi về đơn đi đường template, không gọi LLM** → không bao giờ bịa trạng thái đơn; query scope `{buyerId, shopId}` nên không lộ đơn người khác.
- **Fallback**: Groq lỗi/thiếu key → khách vẫn nhận toàn bộ KB shop (không "chết" tính năng tư vấn).
- **Trace minh bạch**: top-5 + điểm, model, token, thời gian được lưu vào `DirectMessage.trace` và hiển thị ở UI ("Vì sao AI trả lời").

---

## 2. Sơ đồ tuần tự — một lượt hỏi đáp RAG

```mermaid
sequenceDiagram
  autonumber
  actor B as Khách
  participant UI as Inbox UI (socket.io)
  participant GW as Gateway /inbox
  participant FL as flow.ts
  participant RAG as rag/index.ts
  participant DB as PostgreSQL
  participant GQ as Groq API

  B->>UI: "SP01 còn size M không shop?"
  UI->>GW: send_message {conversationId, content, nonce}
  GW->>GW: verify JWT + kiểm tra buyerId sở hữu hội thoại
  GW->>FL: handleBuyerMessage(...)
  FL->>DB: INSERT DirectMessage (BUYER) — dedup theo nonce
  FL-->>UI: emit message (buyer) + ai_thinking(true)

  FL->>DB: đọc mode + version của hội thoại
  alt mode = HUMAN (seller đã tiếp quản)
    FL-->>UI: dừng — AI không trả lời
  else mode = AI
    alt Câu hỏi về đơn (#mã / "đơn", "thanh toán", "giao")
      FL->>DB: SELECT Order WHERE buyerId + shopId
      FL->>DB: INSERT DirectMessage (AI, template) + trace
      FL-->>UI: emit message (AI)
    else Câu hỏi thường — RAG
      FL->>RAG: retrieve(shopId, câu hỏi, topK=5)
      opt Lần đầu của shop (index chưa có trong RAM)
        RAG->>DB: SELECT KbEntry + Product của shop
        RAG->>RAG: embed "passage:" → vector 384 chiều
        RAG->>RAG: lưu index vào RAM (Map theo shopId)
      end
      RAG->>RAG: embed "query:" + cosine + sort → top-5
      RAG-->>FL: 5 entry kèm score
      FL->>DB: KB theo id + toàn bộ Product (giá/kho) + live đang mở + 20 tin gần nhất
      FL->>FL: buildPrompt (system + ngữ cảnh + history)
      FL->>GQ: POST /chat/completions (qwen3.8-27b, timeout 20s)
      alt Groq OK
        GQ-->>FL: content + model + usage
      else GroqError
        GQ-->>FL: lỗi
        FL->>DB: đọc TOÀN BỘ KB của shop (fallback FULL_KB)
      end
      FL->>DB: INSERT DirectMessage (AI) + trace JSON
      FL-->>UI: emit message (AI)
    end
    Note over FL: Seller vừa gửi tay?<br/>mode/version đổi → bỏ kết quả AI (takeover thắng)
  end
  FL-->>UI: ai_thinking(false)
  UI-->>B: Bubble AI + chip nguồn + "Vì sao AI trả lời"
```

---

## 3. Sơ đồ trạng thái — AI / người thật tiếp quản

```mermaid
stateDiagram-v2
  [*] --> AI: Hội thoại mới (mode = AI)
  AI --> AI: Khách nhắn → RAG trả lời
  AI --> HUMAN: Seller gửi tin tay (mode = HUMAN, version + 1)
  HUMAN --> HUMAN: Seller nhắn tay — AI im lặng
  HUMAN --> AI: Seller bấm "Trả lại cho AI" (version + 1)
```

---

## 4. Sơ đồ ASCII (dán nhanh vào Word nếu chưa render Mermaid)

```text
GIAI ĐOẠN 1 — NẠP TRI THỨC (lazy, mỗi shop 1 index trong RAM)
  KbEntry(title, answer) ─┐
                          ├─► ghép text ─► e5-small (local, 384d, "passage:")
  Product(name, sku) ─────┘                     │
                                               ▼
                          Vector index RAM: Map<shopId, entries + vectors>
                          (normalize sẵn → cosine = dot product)
  KB/tên/SKU đổi → invalidateShopIndex(shopId) → lần retrieve sau dựng lại

GIAI ĐOẠN 2 — TRUY VẤN
  Khách gửi tin (socket /inbox, JWT)
        │
        ▼
  flow.ts: lưu tin BUYER ──► phát realtime cho 2 cửa sổ
        │
        ├─ mode = HUMAN? ──► dừng (seller đã tiếp quản)
        ▼
  Câu hỏi về đơn? ──có──► Template từ DB (không gọi LLM)
        │ không
        ▼
  RAG: embed "query:" → cosine với index shop → top-5
        │
        ▼
  Ngữ cảnh: KB top-5 + TOÀN BỘ sản phẩm (giá/kho hiện tại)
            + live đang mở + 20 tin gần nhất
        │
        ▼
  buildPrompt → Groq (qwen3.8-27b, timeout 20s)
        │ OK                          │ GroqError
        ▼                             ▼
  Câu trả lời + trace            Fallback FULL_KB
        └──────────────┬──────────────┘
                       ▼
  Lưu DirectMessage(AI) + trace JSON → phát socket
                       ▼
  UI: bubble AI + chip nguồn + "Vì sao AI trả lời"
```

---

## 5. Thành phần ↔ file code

| Thành phần | File | Vai trò |
|---|---|---|
| Điều phối lượt chat | `lib/chat/flow.ts` | Lưu tin, phát realtime, kiểm tra mode, history 20 tin, chống race takeover (version) |
| Runner AI 3 nhánh | `lib/chat/ai.ts` | Template đơn / RAG / fallback FULL_KB; `buildPrompt` |
| Vector index | `lib/rag/index.ts` | Index RAM theo shop, cosine top-5, `findExactSku`, invalidate |
| Embedder | `lib/rag/embedder.ts` | e5-small q8 384d, lazy, singleton `globalThis` |
| Groq client | `lib/rag/groq.ts` | HTTP thuần, timeout 20s, `GroqError` |
| Trace | `lib/chat/trace.ts` | Schema trace an toàn cho client (topK, products, tokens, fallback, error) |
| Gateway socket | `lib/chat/gateway.ts` | JWT handshake, chỉ chủ hội thoại được join/send |
| Invalidate index | `lib/kb/service.ts`, `lib/products/service.ts` | Gọi `invalidateShopIndex` sau mỗi mutation |
| Lưu trữ | `prisma/schema.prisma` | `KbEntry`, `Product`, `Conversation(mode, version)`, `DirectMessage.trace` |

## 6. Tham số đang dùng

| Tham số | Giá trị | Nơi khai báo |
|---|---|---|
| Embedding model | `Xenova/multilingual-e5-small` (q8, 384 chiều) | `lib/rag/embedder.ts` |
| Tiền tố e5 | `query:` / `passage:` | `buildEmbedText` |
| top-K | 5 | `DEFAULT_TOP_K` |
| Độ tương đồng | cosine (dot trên vector đã normalize) | `dot()` |
| Lịch sử hội thoại | 20 tin gần nhất | `HISTORY_TAKE` |
| LLM | `qwen/qwen3.8-27b` (override bằng `GROQ_MODEL`) | `lib/rag/groq.ts` |
| Timeout LLM | 20 giây | `DEFAULT_TIMEOUT_MS` |
| Fallback | Toàn bộ KB của shop (`FULL_KB`) | `buildFallbackContent` |
| Câu hỏi đơn | regex `#số` hoặc từ khoá đơn/thanh toán/chuyển khoản/giao chưa | `isOrderQuestion` |
