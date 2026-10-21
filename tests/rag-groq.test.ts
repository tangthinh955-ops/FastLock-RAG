import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  chatCompletion,
  DEFAULT_GROQ_MODEL,
  GroqError,
  resolveGroqModel,
  type GroqMessage,
} from "../lib/rag/groq";

/**
 * Unit test cho client Groq: mọi request đi qua `fetchImpl` giả nên bộ test
 * không chạm mạng thật và không cần key thật.
 *
 * Env GROQ_API_KEY/GROQ_MODEL được chụp lúc nạp file rồi khôi phục sau MỖI test:
 * test "thiếu key" phải `delete` env, còn máy chạy có thể có key thật trong
 * `.env` — không được để rò rỉ hay phụ thuộc giá trị đó giữa các test.
 */

const MESSAGES: GroqMessage[] = [
  { role: "user", content: "Chào bạn, shop bán gì?" },
];

const ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";

const savedKey = process.env.GROQ_API_KEY;
const savedModel = process.env.GROQ_MODEL;

beforeEach(() => {
  process.env.GROQ_API_KEY = "groq-test-key";
});

afterEach(() => {
  if (savedKey === undefined) delete process.env.GROQ_API_KEY;
  else process.env.GROQ_API_KEY = savedKey;
  if (savedModel === undefined) delete process.env.GROQ_MODEL;
  else process.env.GROQ_MODEL = savedModel;
});

type FetchCall = { url: string; init: RequestInit };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** fetch giả: ghi lại request rồi trả response dựng sẵn (không chạm mạng). */
function fakeFetch(calls: FetchCall[], response: () => Response): typeof fetch {
  return async (input, init) => {
    calls.push({ url: String(input), init: init ?? {} });
    return response();
  };
}

const SUCCESS_BODY = {
  model: "qwen/qwen3.8-27b",
  choices: [
    { message: { role: "assistant", content: "Shop mình bán áo thun nha!" } },
  ],
  usage: { prompt_tokens: 42, completion_tokens: 7 },
};

describe("rag/groq — chatCompletion qua fetch thuần", () => {
  it("resolveGroqModel: override → GROQ_MODEL env → DEFAULT_GROQ_MODEL", () => {
    delete process.env.GROQ_MODEL;

    expect(resolveGroqModel()).toBe(DEFAULT_GROQ_MODEL);
    expect(resolveGroqModel("opts/model")).toBe("opts/model");

    process.env.GROQ_MODEL = "env/model";
    expect(resolveGroqModel()).toBe("env/model");
    // Override vẫn thắng env.
    expect(resolveGroqModel("opts/model")).toBe("opts/model");
  });

  it("thành công: gọi đúng endpoint/header/body, trả content + model + tokens + elapsedMs", async () => {
    const calls: FetchCall[] = [];
    const fetchImpl = fakeFetch(calls, () => jsonResponse(SUCCESS_BODY));

    const result = await chatCompletion(MESSAGES, { fetchImpl });

    expect(result).toMatchObject({
      content: "Shop mình bán áo thun nha!",
      model: "qwen/qwen3.8-27b",
      promptTokens: 42,
      completionTokens: 7,
    });
    expect(result.elapsedMs).toBeGreaterThanOrEqual(0);

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(ENDPOINT);
    expect(calls[0].init.method).toBe("POST");
    const headers = new Headers(calls[0].init.headers);
    expect(headers.get("authorization")).toBe("Bearer groq-test-key");
    expect(headers.get("content-type")).toContain("application/json");
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      model: DEFAULT_GROQ_MODEL,
      messages: MESSAGES,
    });
  });

  it("ưu tiên model: opts.model → GROQ_MODEL trong env → DEFAULT_GROQ_MODEL", async () => {
    const calls: FetchCall[] = [];
    const fetchImpl = fakeFetch(calls, () => jsonResponse(SUCCESS_BODY));
    const requestedModel = (index: number) =>
      (JSON.parse(String(calls[index].init.body)) as { model: string }).model;

    process.env.GROQ_MODEL = "env/model";
    await chatCompletion(MESSAGES, { fetchImpl });
    await chatCompletion(MESSAGES, { fetchImpl, model: "opts/model" });
    delete process.env.GROQ_MODEL;
    await chatCompletion(MESSAGES, { fetchImpl });

    expect(requestedModel(0)).toBe("env/model");
    expect(requestedModel(1)).toBe("opts/model");
    expect(requestedModel(2)).toBe(DEFAULT_GROQ_MODEL);
  });

  it("HTTP 401 → GroqError kèm status 401 + message tiếng Việt ngắn", async () => {
    const calls: FetchCall[] = [];
    const fetchImpl = fakeFetch(calls, () =>
      jsonResponse({ error: { message: "Invalid API Key" } }, 401),
    );

    const attempt = chatCompletion(MESSAGES, { fetchImpl });
    await expect(attempt).rejects.toBeInstanceOf(GroqError);
    await expect(attempt).rejects.toMatchObject({ status: 401 });
    await expect(attempt).rejects.toThrow("HTTP 401");
    await expect(attempt).rejects.toThrow("Invalid API Key");
  });

  it("quá thời gian chờ (timeoutMs 50) → abort request + GroqError 'Groq quá thời gian chờ'", async () => {
    let receivedSignal: AbortSignal | null = null;
    // fetch giả "treo": không bao giờ resolve, chỉ reject khi signal bị abort —
    // đúng hành vi fetch thật khi AbortController.abort() được gọi.
    const fetchImpl = ((_input: RequestInfo | URL, init?: RequestInit) => {
      receivedSignal = init?.signal ?? null;
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const abortError = new Error("This operation was aborted");
          abortError.name = "AbortError";
          reject(abortError);
        });
      });
    }) as typeof fetch;

    const attempt = chatCompletion(MESSAGES, { fetchImpl, timeoutMs: 50 });
    await expect(attempt).rejects.toBeInstanceOf(GroqError);
    await expect(attempt).rejects.toThrow("Groq quá thời gian chờ");

    // Chứng minh đường abort thật sự chạy: request nhận signal và signal đã bị abort.
    expect(receivedSignal).not.toBeNull();
    expect(receivedSignal!.aborted).toBe(true);
  });

  it("thiếu GROQ_API_KEY → GroqError tiếng Việt, không gọi fetch", async () => {
    delete process.env.GROQ_API_KEY;
    const calls: FetchCall[] = [];
    const fetchImpl = fakeFetch(calls, () => jsonResponse(SUCCESS_BODY));

    const attempt = chatCompletion(MESSAGES, { fetchImpl });
    await expect(attempt).rejects.toBeInstanceOf(GroqError);
    await expect(attempt).rejects.toThrow("GROQ_API_KEY chưa được cấu hình");
    expect(calls).toHaveLength(0);
  });
});
