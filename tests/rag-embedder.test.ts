import { describe, expect, it } from "vitest";
import { buildEmbedText, EMBEDDING_DIM, getEmbedder } from "../lib/rag/embedder";

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
