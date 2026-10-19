import type { IndexEntryKind } from "../rag/index";

/**
 * Trace RAG + bộ đọc an toàn cho UI (tách khỏi `ai.ts` — Task 9).
 *
 * Vì sao tách: `ai.ts` kéo theo `./rag/index` → `./rag/embedder` → `node:path` +
 * `@huggingface/transformers` — chỉ chạy được phía server. UI khách (Task 9) và
 * UI seller (Task 10) là client component nhưng vẫn phải đọc
 * `DirectMessage.trace` (JSON thô từ DB/socket) nên phần "kiểu trace + guard"
 * sống ở file này: chỉ có `import type` (bị xoá khi biên dịch) nên bundle client
 * không bao giờ chạm tới module RAG/Groq.
 *
 * `ai.ts` tái xuất lại y nguyên `AiTrace`/`readTrace` — hợp đồng Task 5 không đổi.
 */

export type AiTrace = {
  model: string;
  topK: {
    id: string;
    title: string;
    kind: IndexEntryKind;
    sku?: string;
    score: number;
  }[];
  products: { sku: string; name: string; price: number; stock: number }[];
  liveSessionId?: string;
  orderLookup?: { code: number; status: string; total: number };
  tokens: { prompt: number; completion: number };
  elapsedMs: number;
  fallback?: "FULL_KB";
  error?: string;
};

/** Một entry topK đủ để UI render chip nguồn. */
function isTopKEntry(value: unknown): value is AiTrace["topK"][number] {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.id === "string" &&
    typeof entry.title === "string" &&
    (entry.kind === "kb" || entry.kind === "product") &&
    (entry.sku === undefined || typeof entry.sku === "string") &&
    typeof entry.score === "number"
  );
}

/** Một dòng sản phẩm trong trace (giá/kho lúc trả lời). */
function isProductRow(value: unknown): value is AiTrace["products"][number] {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const row = value as Record<string, unknown>;
  return (
    typeof row.sku === "string" &&
    typeof row.name === "string" &&
    typeof row.price === "number" &&
    typeof row.stock === "number"
  );
}

function isTokens(value: unknown): value is AiTrace["tokens"] {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const tokens = value as Record<string, unknown>;
  return typeof tokens.prompt === "number" && typeof tokens.completion === "number";
}

function isOrderLookup(
  value: unknown,
): value is NonNullable<AiTrace["orderLookup"]> {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const lookup = value as Record<string, unknown>;
  return (
    typeof lookup.code === "number" &&
    typeof lookup.status === "string" &&
    typeof lookup.total === "number"
  );
}

/** Shape guard tối thiểu — thiếu/sai field thì UI coi như tin "không có truy vết". */
function isTraceShape(value: unknown): value is AiTrace {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const trace = value as Record<string, unknown>;
  return (
    typeof trace.model === "string" &&
    Array.isArray(trace.topK) &&
    trace.topK.every(isTopKEntry) &&
    Array.isArray(trace.products) &&
    trace.products.every(isProductRow) &&
    isTokens(trace.tokens) &&
    typeof trace.elapsedMs === "number" &&
    (trace.liveSessionId === undefined || typeof trace.liveSessionId === "string") &&
    (trace.orderLookup === undefined || isOrderLookup(trace.orderLookup)) &&
    (trace.fallback === undefined || trace.fallback === "FULL_KB") &&
    (trace.error === undefined || typeof trace.error === "string")
  );
}

/**
 * Đọc `DirectMessage.trace` (JSON trong DB) cho UI (Task 9/10): chỉ nhận khi
 * shape đủ để render, ngược lại trả `null` — UI hiện "tin cũ — không có truy
 * vết" thay vì vỡ khi gặp trace cũ/hỏng.
 */
export function readTrace(value: unknown): AiTrace | null {
  return isTraceShape(value) ? value : null;
}
