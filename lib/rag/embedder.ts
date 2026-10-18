import { join } from "node:path";
import type { FeatureExtractionPipeline } from "@huggingface/transformers";

/**
 * Embedder e5-small chạy 100% local (spec §4, spike M1).
 *
 * Model `Xenova/multilingual-e5-small` q8, 384 chiều — spike chốt 8/8 hit@1
 * trên kịch bản demo. e5 bắt buộc tiền tố `query:`/`passage:`, nên mọi văn
 * bản phải đi qua `buildEmbedText` trước khi vào model.
 *
 * ⚠️ Singleton qua `globalThis.__ragEmbedder` (pattern R18 — xem
 * `lib/socket-registry.ts`): Next biên dịch app code theo từng bundle nên nếu
 * để biến module-local thì route handler và `server.ts` (hai instance module
 * trong CÙNG process) sẽ nạp model hai lần. `globalThis` chia sẻ được giữa các
 * instance module — model chỉ nạp một lần cho cả process.
 *
 * Lazy: cả việc import `@huggingface/transformers` lẫn nạp model chỉ xảy ra ở
 * lần `embed()` đầu tiên. Import động (không phải import tĩnh) vì package này
 * require `onnxruntime-node` ngay khi được nạp (~1 s, native addon) — `npm test`
 * không bật RAG_INTEGRATION phải nhanh, offline và không kéo onnxruntime vào.
 */

/** Model id — cũng là khóa cache trong `.cache/transformers` (spike M1). */
export const EMBEDDING_MODEL_ID = "Xenova/multilingual-e5-small";

/** Revision sha HF (spike M1) — ghi vào metadata index khi build (spec §4). */
export const EMBEDDING_MODEL_REVISION = "761b726dd34fb83930e26aab4e9ac3899aa1fa78";

/** Số chiều embedding của e5-small. */
export const EMBEDDING_DIM = 384;

/** Loại văn bản theo quy ước e5: truy vấn hay đoạn tri thức. */
export type EmbedKind = "query" | "passage";

export interface Embedder {
  embed(texts: readonly string[], kind: EmbedKind): Promise<number[][]>;
}

/** Gắn tiền tố e5 bắt buộc: `"query: ..."` hoặc `"passage: ..."`. */
export function buildEmbedText(text: string, kind: EmbedKind): string {
  return `${kind}: ${text}`;
}

declare global {
  var __ragEmbedder: Embedder | undefined;
}

/**
 * Embedder mới với pipeline nạp lazy: chỉ lần `embed()` đầu tiên mới tải model,
 * các lần sau dùng lại (một model/process).
 */
function createEmbedder(): Embedder {
  let extractor: Promise<FeatureExtractionPipeline> | undefined;

  function getExtractor(): Promise<FeatureExtractionPipeline> {
    extractor ??= (async () => {
      const { env, pipeline } = await import("@huggingface/transformers");

      // env.cacheDir phải set TRƯỚC lần pipeline() đầu tiên (spike M1) để dùng
      // cache trong repo — demo chạy offline, không tải lại ~113 MB. Không
      // truyền `revision`: cache key tính theo nhánh "main", truyền revision
      // sẽ trỏ sai đường dẫn của cache đã tải sẵn (thông tin revision nằm ở
      // EMBEDDING_MODEL_REVISION cho metadata index).
      env.cacheDir = join(process.cwd(), ".cache", "transformers");

      return pipeline("feature-extraction", EMBEDDING_MODEL_ID, { dtype: "q8" });
    })();

    return extractor;
  }

  return {
    async embed(texts, kind) {
      const pipe = await getExtractor();
      const output = await pipe(
        texts.map((text) => buildEmbedText(text, kind)),
        { pooling: "mean", normalize: true },
      );
      return output.tolist() as number[][];
    },
  };
}

/** Embedder dùng chung của process — tạo một lần rồi giữ trên `globalThis`. */
export function getEmbedder(): Embedder {
  return (globalThis.__ragEmbedder ??= createEmbedder());
}
