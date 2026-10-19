import type { OrderStatus, PrismaClient } from "../../generated/prisma/client";
import type { Embedder } from "../rag/embedder";
import {
  chatCompletion,
  DEFAULT_GROQ_MODEL,
  GroqError,
  type GroqMessage,
} from "../rag/groq";
import { findExactSku, retrieve } from "../rag/index";
import type { AiTrace } from "./trace";

/**
 * Runner AI của Inbox (Task 5, spec §4/§7.3/§7.5) — ba đường trả lời:
 *
 * 1. Câu hỏi về ĐƠN (`isOrderQuestion`): template xác định từ DB, KHÔNG gọi
 *    Groq — trạng thái đơn lấy thẳng từ `Order` nên luôn khớp thực tế; truy vấn
 *    scope `{ buyerId, shopId }` nên không bao giờ lộ đơn của buyer khác.
 * 2. Câu hỏi thường (RAG): `retrieve` top-k của ĐÚNG shop; prompt gồm KB top-k
 *    (answer đọc lại theo id vì `RetrievedEntry` chỉ có title), TOÀN BỘ sản phẩm
 *    với giá/kho đọc ngay lúc dựng prompt (giá/kho không nằm trong index —
 *    spec §4), phiên live đang mở (nếu có) và lịch sử hội thoại; gọi model.
 * 3. Groq lỗi (`GroqError`: thiếu key / HTTP / quá giờ): fallback full-KB — xin
 *    lỗi ngắn + toàn bộ KB của đúng shop + nhắc khách nhắn lại; trace ghi
 *    `fallback: "FULL_KB"` + `error` cho khối kỹ thuật của UI (Task 9).
 *
 * Lỗi KHÔNG phải `GroqError` (bug lập trình, DB hỏng…) được ném nguyên trạng:
 * Task 7 bắt và biến thành tin xin lỗi — runner không tự nuốt để bug không bị
 * trộn lẫn với sự cố Groq (khi đó fallback full-KB sẽ che mất lỗi thật).
 *
 * Test khép kín nhờ hai điểm tiêm của `createAiRunner` (ruling R-P2):
 * `chatCompletion` và `embedder` — bộ test không chạm mạng, không nạp model e5.
 */

/**
 * Kiểu trace + `readTrace` sống ở `./trace` (client-safe) và được tái xuất tại
 * đây để giữ nguyên hợp đồng Task 5 cho mọi caller hiện có.
 */
export { readTrace } from "./trace";
export type { AiTrace } from "./trace";

export type AiAnswer = { content: string; trace: AiTrace };

export type AiRunnerInput = {
  conversationId: string;
  shopId: string;
  buyerId: string;
  text: string;
  history: { source: string; content: string }[];
};

export type AiRunner = {
  answer(prisma: PrismaClient, input: AiRunnerInput): Promise<AiAnswer>;
};

/** Model giả trong trace của đường template đơn — UI kỹ thuật hiện nhãn này. */
const ORDER_TEMPLATE_MODEL = "order-template";

const ORDER_CODE_RE = /#\s*(\d+)/;
const ORDER_KEYWORD_RE = /đơn|thanh toán|chuyển khoản|giao chưa/i;
const EXACT_SKU_RE = /\bSP\d{2}\b/i;

/** Nhãn trạng thái đơn cho khách (thẻ đơn UI dùng đúng bộ nhãn này). */
const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  PENDING: "chờ thanh toán",
  PAID: "đã thanh toán",
  SHIPPED: "đang giao",
  CANCELLED: "đã hủy",
};

const NO_ORDER_REPLY = "Mình chưa thấy đơn nào của bạn ở shop này.";

const priceFormatter = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 });

/** "300000" → "300.000đ" — cùng định dạng với các thẻ đơn ngoài UI. */
function formatVnd(value: number): string {
  return `${priceFormatter.format(value)}đ`;
}

/**
 * Câu hỏi về đơn theo quy ước spec §4: có mã dạng `#số` hoặc từ khoá thường
 * dùng ("đơn", "thanh toán", "chuyển khoản", "giao chưa" — không phân biệt
 * hoa/thường). Cố tình khớp rộng: thà trả template đơn còn hơn để model tự bịa
 * trạng thái đơn từ ngữ cảnh RAG.
 */
function isOrderQuestion(text: string): boolean {
  return ORDER_CODE_RE.test(text) || ORDER_KEYWORD_RE.test(text);
}

/**
 * Vai trò Groq của từng nguồn tin trong lịch sử: BUYER → user, AI/SELLER →
 * assistant. SYSTEM bị BỎ vì đó là thông báo do hệ thống sinh (đã tạo đơn, nhắc
 * thanh toán), không phải lượt hội thoại — trộn vào sẽ sai vai; thông tin đơn
 * hàng đã có đường template riêng ở trên.
 */
function historyRole(source: string): "user" | "assistant" | null {
  switch (source) {
    case "BUYER":
      return "user";
    case "AI":
    case "SELLER":
      return "assistant";
    default:
      return null;
  }
}

/**
 * Dựng messages cho Groq: MỘT system message (chỉ dẫn + toàn bộ ngữ cảnh) rồi
 * tới lịch sử đã map vai, cuối cùng là câu hỏi mới. Vì sao gộp ngữ cảnh vào
 * system: chỉ dẫn "chỉ dùng ngữ cảnh, không bịa" phải đi cùng dữ liệu trong
 * cùng một khối để model không lẫn dữ liệu shop với lượt trò chuyện.
 */
export function buildPrompt(input: {
  shopName: string;
  live: { title: string } | null;
  kb: { title: string; answer: string }[];
  products: { sku: string; name: string; price: number; stock: number }[];
  history: { source: string; content: string }[];
  question: string;
}): GroqMessage[] {
  const lines = [
    `Bạn là nhân viên tư vấn của shop "${input.shopName}" trên LiveOrder, đang trả lời khách trong khung chat.`,
    "Quy tắc:",
    "- Chỉ dùng thông tin trong phần NGỮ CẢNH dưới đây; tuyệt đối không bịa giá, tồn kho, chính sách hay khuyến mãi.",
    '- Nếu câu hỏi nằm ngoài ngữ cảnh, hãy nói mình chưa có thông tin đó và mời khách để lại câu hỏi cho nhân viên shop.',
    '- Trả lời ngắn gọn (1–3 câu), thân thiện, tiếng Việt; xưng "mình" và gọi khách là "bạn".',
    "",
    "NGỮ CẢNH:",
  ];

  if (input.live !== null) {
    lines.push(
      `- Shop đang lên sóng: "${input.live.title}" — nhắc khách vào xem và chốt đơn trong phiên live.`,
    );
  }

  lines.push("Sản phẩm của shop (giá và tồn kho hiện tại):");
  if (input.products.length === 0) {
    lines.push("- Shop chưa có sản phẩm nào.");
  } else {
    for (const product of input.products) {
      lines.push(
        `- ${product.sku} · ${product.name} — ${formatVnd(product.price)}, còn ${product.stock}`,
      );
    }
  }

  lines.push("Kiến thức của shop:");
  if (input.kb.length === 0) {
    lines.push("- Shop chưa có mục kiến thức nào.");
  } else {
    for (const entry of input.kb) {
      lines.push(`- ${entry.title}: ${entry.answer}`);
    }
  }

  const messages: GroqMessage[] = [{ role: "system", content: lines.join("\n") }];
  for (const message of input.history) {
    const role = historyRole(message.source);
    if (role !== null) {
      messages.push({ role, content: message.content });
    }
  }
  messages.push({ role: "user", content: input.question });
  return messages;
}

/**
 * Trả lời template cho câu hỏi về đơn — CHỈ đọc đơn của chính `buyerId` trong
 * `shopId` (scope cả hai cột, spec §7.3). Không có `#code`: kể đơn mới nhất
 * (`orderBy: code desc`); có `#code`: chỉ trả khi mã đó thuộc buyer — không
 * khớp thì trả lời "chưa thấy" và KHÔNG tiết lộ mã đó có tồn tại ở người khác.
 */
async function answerOrderQuestion(
  prisma: PrismaClient,
  input: AiRunnerInput,
): Promise<AiAnswer> {
  const startedAt = Date.now();

  const orders = await prisma.order.findMany({
    where: { buyerId: input.buyerId, shopId: input.shopId },
    orderBy: { code: "desc" },
    include: { product: true },
  });

  const codeMatch = ORDER_CODE_RE.exec(input.text);
  const wantedCode = codeMatch === null ? null : Number(codeMatch[1]);
  const order =
    wantedCode === null
      ? orders[0]
      : orders.find((candidate) => candidate.code === wantedCode);

  const trace: AiTrace = {
    model: ORDER_TEMPLATE_MODEL,
    topK: [],
    products: [],
    tokens: { prompt: 0, completion: 0 },
    elapsedMs: Date.now() - startedAt,
  };

  if (order === undefined) {
    return {
      content:
        wantedCode === null
          ? NO_ORDER_REPLY
          : `Mình chưa thấy đơn #${wantedCode} nào của bạn ở shop này nhé.`,
      trace,
    };
  }

  const content = `Đơn #${order.code} — ${order.product.name} ×${order.qty} — ${formatVnd(order.total)} — trạng thái ${ORDER_STATUS_LABELS[order.status]}.`;
  return {
    content:
      order.status === "PENDING"
        ? `${content} Bạn vào mục Đơn của tôi để quét QR thanh toán (Plan 3) cho shop gửi hàng sớm nhé.`
        : content,
    trace: {
      ...trace,
      orderLookup: { code: order.code, status: order.status, total: order.total },
    },
  };
}

/**
 * Nội dung fallback khi Groq lỗi: xin lỗi ngắn + TOÀN BỘ KB của đúng shop
 * (spec §4) + nhắc khách nhắn lại. Đọc thẳng từ DB thay vì dùng top-k vì mục
 * tiêu là khách vẫn nhận được mọi thông tin shop đã chuẩn bị.
 */
async function buildFallbackContent(
  prisma: PrismaClient,
  shopId: string,
): Promise<string> {
  const entries = await prisma.kbEntry.findMany({
    where: { shopId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });

  const lines = [
    "Mình xin lỗi, hệ thống đang bận một chút nên chưa trả lời chi tiết được ngay. Bạn xem tạm thông tin shop mình đã chuẩn bị nhé:",
    ...(entries.length === 0
      ? ["(Shop chưa có mục thông tin nào.)"]
      : entries.map((entry) => `📚 ${entry.title}:\n${entry.answer}`)),
    "Bạn nhắn lại giúp mình sau ít phút để được tư vấn đầy đủ nhé.",
  ];
  return lines.join("\n\n");
}

/**
 * Đường RAG: truy hồi + dựng prompt + gọi model, lỗi `GroqError` thì fallback
 * full-KB. `embedder` chỉ dùng khi được tiêm (test); production để `undefined`
 * cho `retrieve` tự lấy embedder thật của process.
 */
async function answerWithRag(
  prisma: PrismaClient,
  input: AiRunnerInput,
  chat: typeof chatCompletion,
  embedder: Embedder | undefined,
): Promise<AiAnswer> {
  const startedAt = Date.now();

  // Chỉ tra SKU chính xác khi câu hỏi nêu rõ mã (spec §7.5) — tách khỏi cosine.
  const sku = input.text.match(EXACT_SKU_RE)?.[0] ?? null;

  const [shop, { entries }, products, exactSku, live] = await Promise.all([
    prisma.shop.findUniqueOrThrow({
      where: { id: input.shopId },
      select: { name: true },
    }),
    retrieve(prisma, input.shopId, input.text, { embedder }),
    prisma.product.findMany({
      where: { shopId: input.shopId },
      orderBy: { sku: "asc" },
    }),
    sku === null ? Promise.resolve(null) : findExactSku(prisma, input.shopId, sku),
    prisma.liveSession.findFirst({
      where: { shopId: input.shopId, status: "LIVE" },
      orderBy: { startedAt: "desc" },
    }),
  ]);

  // `RetrievedEntry` không mang answer → đọc KB theo id rồi map lại đúng thứ tự
  // top-k. Vẫn lọc thêm `shopId` cho chắc (id đã đến từ index của shop): entry
  // KB đã bị xoá/đổi shop sau lúc dựng index sẽ bị bỏ qua an toàn, không lọt.
  const kbIds = entries.filter((entry) => entry.kind === "kb").map((entry) => entry.id);
  const kbRows =
    kbIds.length === 0
      ? []
      : await prisma.kbEntry.findMany({
          where: { id: { in: kbIds }, shopId: input.shopId },
        });
  const kbById = new Map(kbRows.map((row) => [row.id, row]));
  const kb = kbIds.flatMap((id) => {
    const row = kbById.get(id);
    return row === undefined ? [] : [{ title: row.title, answer: row.answer }];
  });

  // Prompt (và trace) ghi TOÀN BỘ sản phẩm của shop với giá/kho đọc ngay lúc
  // này; kết quả findExactSku được gộp theo id để mã khách nêu luôn có mặt đúng
  // hàng của shop này và không bị nhân đôi.
  const productsById = new Map(products.map((product) => [product.id, product]));
  if (exactSku !== null) {
    productsById.set(exactSku.id, exactSku);
  }
  const productRows = [...productsById.values()].sort((a, b) =>
    a.sku.localeCompare(b.sku),
  );
  const promptProducts = productRows.map((product) => ({
    sku: product.sku,
    name: product.name,
    price: product.price,
    stock: product.stock,
  }));

  const messages = buildPrompt({
    shopName: shop.name,
    live: live === null ? null : { title: live.title },
    kb,
    products: promptProducts,
    history: input.history,
    question: input.text,
  });
  const topK = entries.map((entry) => ({
    id: entry.id,
    title: entry.title,
    kind: entry.kind,
    sku: entry.sku,
    score: entry.score,
  }));

  try {
    const result = await chat(messages);
    return {
      content: result.content,
      trace: {
        model: result.model,
        topK,
        products: promptProducts,
        ...(live === null ? {} : { liveSessionId: live.id }),
        tokens: { prompt: result.promptTokens, completion: result.completionTokens },
        elapsedMs: Date.now() - startedAt,
      },
    };
  } catch (error) {
    if (!(error instanceof GroqError)) {
      throw error; // Task 7 xử lý; không nuốt lỗi bất ngờ (khác sự cố Groq)
    }
    return {
      content: await buildFallbackContent(prisma, input.shopId),
      trace: {
        // Không có `result.model` vì lần gọi thất bại — ghi model đang dùng mặc
        // định để UI kỹ thuật biết đã cố gọi model nào.
        model: DEFAULT_GROQ_MODEL,
        topK,
        products: promptProducts,
        ...(live === null ? {} : { liveSessionId: live.id }),
        tokens: { prompt: 0, completion: 0 },
        elapsedMs: Date.now() - startedAt,
        fallback: "FULL_KB",
        error: error.message,
      },
    };
  }
}

/**
 * Runner dùng chung: `chatCompletion` thật (production) hoặc giả (test);
 * `embedder` chỉ để test truyền fake qua `retrieve` (ruling R-P2).
 */
export function createAiRunner(deps: {
  chatCompletion?: typeof chatCompletion;
  embedder?: Embedder;
} = {}): AiRunner {
  const chat = deps.chatCompletion ?? chatCompletion;

  return {
    async answer(prisma, input) {
      // Câu hỏi về đơn không đi qua model — trạng thái luôn khớp DB (spec §4).
      if (isOrderQuestion(input.text)) {
        return answerOrderQuestion(prisma, input);
      }
      return answerWithRag(prisma, input, chat, deps.embedder);
    },
  };
}
