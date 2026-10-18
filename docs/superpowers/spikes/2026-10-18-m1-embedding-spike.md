# Spike M1 — Embedding tiếng Việt trên Windows (kết quả chốt model)

**Ngày:** 18/10/2026 · **Trạng thái:** ✅ Đạt — không có blocker, đã chốt model cho Plan 2.

## Bối cảnh

Spec §4 yêu cầu embedding **100% local** bằng `@huggingface/transformers` (Transformers.js), chạy CPU,
cache model xuống đĩa. Spec §11 M1 + §13 rủi ro #1: **phải spike trên Windows trước khi cam kết**
(onnxruntime-node chưa được kiểm chứng). §15 cho phép người thực thi tự chốt model.

## Cách chạy

- Thư mục tạm: `%TEMP%\opencode\embedding-spike` (ngoài repo), `npm install @huggingface/transformers`.
- Script `spike.mjs`: nạp KB **thật** từ seed (9 entries, 2 shop), embed `title + answer`, chạy 8 câu hỏi
  tiếng Việt theo kịch bản demo (spec §10), tính cosine top-3, đo load/embed/RAM.
- Máy: Windows 11, Node v22.20.0, transformiers.js **4.3.1**, CPU.

## Kết quả

| | `Xenova/multilingual-e5-small` | `Xenova/paraphrase-multilingual-MiniLM-L12-v2` |
|---|---|---|
| Kiểu | e5 (cần tiền tố `query: ` / `passage: `) | MiniLM |
| Chiều | 384 | 384 |
| Dung lượng (q8, cache) | ~113 MB | ~113 MB |
| Load lần đầu (gồm tải mạng) | ~28.4 s | ~29.3 s |
| Load lại từ cache (cả process) | ~2.5 s | ~2.5 s |
| Embed batch 9 passages | 548 ms (~61 ms/text) | 532 ms (~59 ms/text) |
| Embed 1 query | 6–10 ms | 6–8 ms |
| RSS sau embed | ~512 MB | ~501 MB |
| **hit@1 / hit@3 (8 câu hỏi demo)** | **8/8 · 8/8** | 3/8 · 6/8 |

Câu hỏi kiểm tra gồm cả ca "chống lẫn shop" (§7.8): hỏi "bên Bảo An đổi trả mấy ngày" trong khi KB hai
shop đều có mục đổi trả — e5-small xếp đúng `kb-baoan-return` top-1; MiniLM nhầm sang `kb-linh-return`.

## Quyết định chốt (dùng cho Plan 2)

- **Model:** `Xenova/multilingual-e5-small`, **revision `761b726dd34fb83930e26aab4e9ac3899aa1fa78`**
  (sha HF, lastModified 2025-07-22) — ghi vào metadata index (spec §4).
- **dtype:** `q8` (quantized) — đủ chất lượng, ~113 MB, nhanh trên CPU.
- **Tiền tố bắt buộc:** passage `"passage: {title}\n{answer}"`, query `"query: {text}"` (không dùng
  tiền tố ⇒ chất lượng tụt — đã thấy rõ khi MiniLM không cần tiền tố nhưng vẫn thua xa).
- **Cache:** thư mục cố định trong repo `.cache/transformers/` (gitignore) — lần demo không cần mạng.
  Lần đầu cần internet (~113 MB); README phải ghi rõ.
- **RAM:** ~512 MB process — chấp nhận cho demo (spec §13 rủi ro #5 đã lường trước).

## Ghi chú kỹ thuật cho Plan 2

- `env.cacheDir` phải set **trước** lần gọi `pipeline()` đầu tiên.
- Pipeline nên nạp lazy + singleton qua `globalThis` (cùng lý do R18 ở Plan 1: module Next 16 tách
  theo bundle — REST route và `server.ts` là hai instance, nếu để `let` thường sẽ nạp model 2 lần).
- Test unit **không** được phụ thuộc model thật (không tải mạng khi `npm test`): thiết kế interface
  `Embedder` injectable, test dùng fake; giữ 1 integration test opt-in qua env (`RAG_INTEGRATION=1`).
