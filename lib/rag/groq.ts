/**
 * Client Groq Chat Completions gọi bằng `fetch` thuần, không SDK (spec §4) —
 * đúng một endpoint nên thêm dependency là thừa; Task 5 dùng hàm này để sinh
 * câu trả lời RAG.
 *
 * - Timeout mặc định 20 s qua `AbortController`: model có thể treo, không để
 *   request giữ gateway vô hạn; tầng trên (Task 5) bắt `GroqError` để fallback.
 * - `GroqError` gói các lỗi có ngữ nghĩa (thiếu key / HTTP !ok / quá giờ) kèm
 *   `status` khi có, tách khỏi lỗi hạ tầng thô để nơi gọi xử lý thống nhất.
 * - `opts.fetchImpl` để test khép kín với fetch giả — bộ test không chạm mạng.
 */

// Chốt từ smoke task 4 (2026-10-18): key demo KHÔNG có `qwen/qwen3-32b`
// (404 model_not_found); danh sách /models chỉ còn `qwen/qwen3.8-27b` là Qwen
// chat model. Đổi model = sửa hằng này hoặc env GROQ_MODEL, không sửa call site.
export const DEFAULT_GROQ_MODEL = "qwen/qwen3.8-27b";

export type GroqMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type GroqResult = {
  content: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  elapsedMs: number;
};

/** Lỗi client Groq; `status` chỉ có khi lỗi đến từ HTTP !ok. */
export class GroqError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "GroqError";
    this.status = status;
  }
}

const GROQ_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";

/** Quá hạn này coi như Groq treo — đủ rộng cho câu trả lời dài, đủ ngắn cho chat. */
const DEFAULT_TIMEOUT_MS = 20_000;

/** Chỉ giữ đầu body lỗi làm manh mối debug — không đọc cả response vào message/log. */
const ERROR_SNIPPET_MAX = 200;

/** Phần response OpenAI-compatible mà client thực sự đọc (giữ tối thiểu). */
type ChatCompletionsResponse = {
  model: string;
  choices: { message: { content: string } }[];
  usage: { prompt_tokens: number; completion_tokens: number };
};

/**
 * Model đang dùng: model truyền tay > `GROQ_MODEL` trong env > hằng mặc định.
 * Tách khỏi `chatCompletion` để trace fallback (nơi không có `result.model`) ghi
 * đúng model đã cố gọi, kể cả khi env đổi model.
 */
export function resolveGroqModel(override?: string): string {
  return override ?? process.env.GROQ_MODEL ?? DEFAULT_GROQ_MODEL;
}

export async function chatCompletion(
  messages: GroqMessage[],
  opts: { model?: string; timeoutMs?: number; fetchImpl?: typeof fetch } = {},
): Promise<GroqResult> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new GroqError("GROQ_API_KEY chưa được cấu hình");
  }

  const model = resolveGroqModel(opts.model);
  const fetchImpl = opts.fetchImpl ?? fetch;
  const startedAt = Date.now();

  // `timedOut` phân biệt abort do HẾT GIỜ (dịch thành lỗi tiếng Việt) với mọi
  // lỗi khác (ném nguyên trạng cho tầng trên tự quyết). Signal chỉ có một nguồn
  // abort duy nhất là timer này nên cờ là dấu hiệu đáng tin.
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  try {
    const response = await fetchImpl(GROQ_ENDPOINT, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ model, messages }),
      signal: controller.signal,
    });

    if (!response.ok) {
      // Groq trả JSON mô tả lỗi; trích ngắn để message có manh mối khi debug.
      const snippet = (await response.text()).slice(0, ERROR_SNIPPET_MAX);
      throw new GroqError(
        `Groq trả lỗi HTTP ${response.status}: ${snippet}`,
        response.status,
      );
    }

    const body = (await response.json()) as ChatCompletionsResponse;
    return {
      content: body.choices[0].message.content,
      model: body.model,
      promptTokens: body.usage.prompt_tokens,
      completionTokens: body.usage.completion_tokens,
      elapsedMs: Date.now() - startedAt,
    };
  } catch (error) {
    // Lỗi HTTP có thể được ném đúng lúc timer vừa nổ — giữ lỗi HTTP gốc, chỉ
    // dịch lỗi do chính abort (fetch thật reject kèm AbortError).
    if (timedOut && !(error instanceof GroqError)) {
      throw new GroqError("Groq quá thời gian chờ");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
