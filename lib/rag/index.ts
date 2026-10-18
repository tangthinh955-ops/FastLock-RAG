import type { PrismaClient, Product } from "../../generated/prisma/client";
import {
  EMBEDDING_MODEL_ID,
  EMBEDDING_MODEL_REVISION,
  getEmbedder,
  type Embedder,
} from "./embedder";

/**
 * Index RAG giữ trong RAM theo từng shop (spec §4 "Vector store") + truy vấn
 * top-k, tra SKU chính xác (spec §7.5/§7.8 "RAG đúng shop") — Task 3 Plan 2.
 *
 * Vì sao Map trên `globalThis` (pattern R18/R19 — xem `lib/socket-registry.ts`,
 * `lib/rag/embedder.ts`): Next biên dịch app code theo TỪNG bundle nên biến
 * module-local bị nhân thành nhiều index độc lập trong cùng process (route
 * handler khác bundle với `server.ts`) — mỗi bundle sẽ embed bù lại từ đầu.
 * `globalThis` giữ đúng MỘT index cho cả process.
 *
 * Quyết định đã chốt (để Task 5 khỏi đoán):
 * - Text vector: KB = `{title}\n{answer}`, sản phẩm = `Sản phẩm {name} (mã
 *   {sku})`. Giá/kho KHÔNG vào vector (spec §4) — giá/kho chỉ đọc từ DB lúc
 *   dựng prompt; đổi giá/kho không cần invalidate, còn KbEntry hoặc tên/SKU
 *   sản phẩm đổi/xoá thì nơi ghi gọi `invalidateShopIndex` (spec §4: "index vô
 *   hiệu/embed lại khi KbEntry hoặc tên/SKU Product đổi/xóa").
 * - Lazy hoàn toàn: không đụng DB/model ở lúc import; lần `retrieve` đầu của
 *   một shop mới dựng index (test tiêm embedder giả qua `opts.embedder`).
 * - Vector đã normalize sẵn (embedder thật dùng `normalize: true`) nên điểm =
 *   tích vô hướng; sort giảm dần rồi cắt `topK ?? 5`.
 * - `findExactSku` tách RIÊNG khỏi retrieve — spec §7.5 bắt buộc: mã nêu rõ
 *   trong câu hỏi phải tra chính xác trong shop đó, không thay bằng sản phẩm
 *   gần giống qua cosine.
 */

export type IndexEntryKind = "kb" | "product";

/** Entry trả về từ `retrieve` — đủ cho chip nguồn + Truy vết RAG (Task 5/9). */
export type RetrievedEntry = {
  id: string;
  kind: IndexEntryKind;
  title: string;
  /** Chỉ có với entry sản phẩm. */
  sku?: string;
  score: number;
};

/** Metadata của index một shop — `builtAt` đổi mỗi lần dựng lại (test rebuild). */
export type ShopIndexMeta = {
  shopId: string;
  builtAt: string;
  modelId: string;
  revision: string;
  kbCount: number;
  productCount: number;
};

/** Số entry trả về mặc định khi không truyền `topK`. */
const DEFAULT_TOP_K = 5;

/** Entry đã embed (chưa có điểm) — `vectors[i]` tương ứng `entries[i]`. */
type IndexedEntry = {
  id: string;
  kind: IndexEntryKind;
  title: string;
  sku?: string;
};

type ShopIndex = {
  meta: ShopIndexMeta;
  entries: IndexedEntry[];
  vectors: number[][];
};

declare global {
  var __ragShopIndexes: Map<string, ShopIndex> | undefined;
}

/** Map index của process — tạo lazy ở lần dùng đầu tiên. */
function shopIndexes(): Map<string, ShopIndex> {
  return (globalThis.__ragShopIndexes ??= new Map());
}

/**
 * Dựng index một shop từ DB: embed MỘT lô passage (KB trước, sản phẩm sau —
 * hai mảng khớp chỉ số với `entries`). Chỉ đọc đúng `shopId` (spec §7.5/§7.8).
 */
async function buildIndex(
  prisma: PrismaClient,
  shopId: string,
  embedder: Embedder,
): Promise<ShopIndex> {
  const [kbEntries, products] = await Promise.all([
    prisma.kbEntry.findMany({ where: { shopId } }),
    prisma.product.findMany({ where: { shopId } }),
  ]);

  const entries: IndexedEntry[] = [
    ...kbEntries.map((kb) => ({ id: kb.id, kind: "kb" as const, title: kb.title })),
    ...products.map((product) => ({
      id: product.id,
      kind: "product" as const,
      title: product.name,
      sku: product.sku,
    })),
  ];
  const texts = [
    ...kbEntries.map((kb) => `${kb.title}\n${kb.answer}`),
    ...products.map((product) => `Sản phẩm ${product.name} (mã ${product.sku})`),
  ];

  // Shop chưa có KB/sản phẩm: không gọi embedder với lô rỗng (model thật không
  // nhận batch rỗng) — index rỗng vẫn hợp lệ.
  const vectors = texts.length === 0 ? [] : await embedder.embed(texts, "passage");

  return {
    meta: {
      shopId,
      builtAt: new Date().toISOString(),
      modelId: EMBEDDING_MODEL_ID,
      revision: EMBEDDING_MODEL_REVISION,
      kbCount: kbEntries.length,
      productCount: products.length,
    },
    entries,
    vectors,
  };
}

/** Tích vô hướng = cosine, vì hai vector đều đã normalize. */
function dot(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) {
    sum += a[i] * b[i];
  }
  return sum;
}

/**
 * Truy vấn top-k cho MỘT shop: dựng index lazy ở lần gọi đầu rồi giữ trong RAM
 * tới khi bị invalidate; các lần sau chỉ embed câu hỏi. Hỏi shop nào chỉ trả
 * entry của shop đó — không lẫn shop (spec §7.5/§7.8).
 *
 * Hai `retrieve` song song của cùng shop mới có thể cùng dựng index (không
 * khoá); bản ghi sau đè bản trước — vô hại vì cùng dựng từ một trạng thái DB.
 */
export async function retrieve(
  prisma: PrismaClient,
  shopId: string,
  query: string,
  opts?: { topK?: number; embedder?: Embedder },
): Promise<{ entries: RetrievedEntry[]; meta: ShopIndexMeta }> {
  const embedder = opts?.embedder ?? getEmbedder();
  const store = shopIndexes();

  let index = store.get(shopId);
  if (index === undefined) {
    index = await buildIndex(prisma, shopId, embedder);
    store.set(shopId, index);
  }

  const [queryVector] = await embedder.embed([query], "query");

  const scored = index.entries.map((entry, i) => ({
    ...entry,
    score: dot(index.vectors[i], queryVector),
  }));
  scored.sort((a, b) => b.score - a.score);

  return { entries: scored.slice(0, opts?.topK ?? DEFAULT_TOP_K), meta: index.meta };
}

/**
 * Tra chính xác một SKU trong MỘT shop (spec §7.5 — không thay bằng sản phẩm
 * gần giống qua cosine). SKU được upper-case trước khi tra; `@@unique([shopId,
 * sku])` bảo đảm tối đa một hàng — SP01 của shop khác không bao giờ bị trả về.
 */
export async function findExactSku(
  prisma: PrismaClient,
  shopId: string,
  sku: string,
): Promise<Product | null> {
  return prisma.product.findUnique({
    where: { shopId_sku: { shopId, sku: sku.toUpperCase() } },
  });
}

/**
 * Xoá index của một shop — lần `retrieve` kế tiếp dựng lại từ DB. Nơi ghi gọi
 * khi KB hoặc tên/SKU sản phẩm của shop đổi/xoá (spec §4).
 */
export function invalidateShopIndex(shopId: string): void {
  shopIndexes().delete(shopId);
}

/**
 * Xoá index của mọi shop — dùng trong test để cách ly các bài (RAM không tự
 * reset theo `resetDb`).
 */
export function invalidateAllShopIndexes(): void {
  shopIndexes().clear();
}
