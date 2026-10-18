import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createAiRunner, readTrace, type AiTrace } from "../lib/chat/ai";
import type { Embedder } from "../lib/rag/embedder";
import {
  chatCompletion,
  GroqError,
  type GroqMessage,
  type GroqResult,
} from "../lib/rag/groq";
import { invalidateAllShopIndexes } from "../lib/rag/index";
import { resetDb, testPrisma } from "./helpers/db";

/**
 * Integration thật trên Postgres test cho runner AI (Task 5). Cả `chatCompletion`
 * lẫn `embedder` đều được TIÊM GIẢ qua `createAiRunner` — bộ test không chạm
 * mạng, không nạp model e5, không cần `GROQ_API_KEY`.
 *
 * Index RAG là singleton mức process (globalThis) nên `invalidateAllShopIndexes`
 * chạy trước mỗi test: `resetDb` xoá DB nhưng không đụng RAM.
 */

/**
 * Embedder giả: vector 8 chiều tất định theo độ dài text (dot luôn khớp chiều).
 * Fixture nhỏ hơn topK mặc định (5) nên `retrieve` trả đủ KB + sản phẩm của
 * shop; các test này không cần xếp hạng "đúng chủ đề".
 */
function fakeEmbedder(): Embedder {
  return {
    async embed(texts) {
      return texts.map((text) => {
        const vector = new Array<number>(8).fill(0);
        vector[text.length % vector.length] = 1;
        return vector;
      });
    },
  };
}

type FakeChat = {
  chat: typeof chatCompletion;
  /** Nguyên văn messages từng lần gọi — assert đúng prompt gửi cho model. */
  calls: GroqMessage[][];
};

/** Chat giả dùng chung: ghi lại messages rồi uỷ quyền cho `handler`. */
function createFakeChat(
  handler: (messages: GroqMessage[]) => Promise<GroqResult>,
): FakeChat {
  const calls: GroqMessage[][] = [];
  const chat: typeof chatCompletion = async (messages) => {
    calls.push(messages);
    return handler(messages);
  };
  return { chat, calls };
}

/** Trả lời thành công với content/model/tokens cố định — assert thẳng vào trace. */
function replyChat(content: string): FakeChat {
  return createFakeChat(async () => ({
    content,
    model: "fake-model",
    promptTokens: 12,
    completionTokens: 7,
    elapsedMs: 3,
  }));
}

type KbSeed = { id: string; title: string; answer: string };

type Fixture = {
  shopA: string;
  shopB: string;
  buyerA: string;
  buyerB: string;
  productASp01: string;
  productASp02: string;
  /** Đơn CŨ của buyer A (PAID, code nhỏ hơn) — không được hiện khi hỏi đơn mới nhất. */
  orderAPaid: { code: number; total: number };
  /** Đơn MỚI NHẤT của buyer A (PENDING) — template phải trả đơn này. */
  orderAPending: { code: number; total: number };
  /** Đơn của buyer B nằm NGAY trong shop A (code 999) — dữ liệu cấm rò rỉ. */
  orderBForeign: { code: number; total: number };
  kbA: KbSeed[];
  kbB: KbSeed[];
};

/** 2 shop, KB/sản phẩm trùng chủ đề (SP01 khác giá), đơn chéo buyer — đủ mọi case. */
async function seedFixture(): Promise<Fixture> {
  const ownerA = await testPrisma.user.create({
    data: { email: "owner-a@test.vn", passwordHash: "x", name: "Linh", role: "SELLER" },
  });
  const ownerB = await testPrisma.user.create({
    data: { email: "owner-b@test.vn", passwordHash: "x", name: "Bảo An", role: "SELLER" },
  });
  const buyerA = await testPrisma.user.create({
    data: { email: "buyer-a@test.vn", passwordHash: "x", name: "Khách A", role: "BUYER" },
  });
  const buyerB = await testPrisma.user.create({
    data: { email: "buyer-b@test.vn", passwordHash: "x", name: "Khách B", role: "BUYER" },
  });

  const shopA = await testPrisma.shop.create({
    data: { name: "Shop Thời Trang Linh", ownerId: ownerA.id },
  });
  const shopB = await testPrisma.shop.create({
    data: { name: "Shop Áo Sơ Mi Bảo An", ownerId: ownerB.id },
  });

  const productASp01 = await testPrisma.product.create({
    data: { shopId: shopA.id, sku: "SP01", name: "Áo thun basic", price: 150_000, stock: 8 },
  });
  const productASp02 = await testPrisma.product.create({
    data: { shopId: shopA.id, sku: "SP02", name: "Quần jogger", price: 220_000, stock: 5 },
  });
  // SP01 trùng mã ở shop B nhưng tên/giá khác — mọi test phải thấy dữ liệu shop A.
  await testPrisma.product.create({
    data: { shopId: shopB.id, sku: "SP01", name: "Áo sơ mi công sở", price: 200_000, stock: 5 },
  });

  const kbA: KbSeed[] = [
    await testPrisma.kbEntry.create({
      data: {
        shopId: shopA.id,
        title: "Bảng size áo thun",
        answer: "Chọn size theo chiều cao và cân nặng.",
      },
    }),
    await testPrisma.kbEntry.create({
      data: {
        shopId: shopA.id,
        title: "Chính sách đổi trả 7 ngày",
        answer: "Đổi trả trong 7 ngày nếu còn tag.",
      },
    }),
  ];
  const kbB: KbSeed[] = [
    await testPrisma.kbEntry.create({
      data: {
        shopId: shopB.id,
        title: "Đổi trả trong 3 ngày",
        answer: "Shop B chỉ đổi trả trong 3 ngày, quá hạn không nhận.",
      },
    }),
  ];

  // Phiên live CŨ đã kết thúc — chỉ phiên LIVE mới được nhắc trong prompt (case e).
  await testPrisma.liveSession.create({
    data: {
      shopId: shopA.id,
      title: "Live cũ đã kết thúc",
      status: "ENDED",
      endedAt: new Date(),
    },
  });

  const orderAPaid = await testPrisma.order.create({
    data: {
      shopId: shopA.id,
      buyerId: buyerA.id,
      productId: productASp01.id,
      qty: 1,
      unitPrice: 150_000,
      total: 150_000,
      status: "PAID",
      paidAt: new Date(),
      eventId: "evt-a-paid",
      paymentCode: "pay-a-paid",
    },
  });
  const orderAPending = await testPrisma.order.create({
    data: {
      shopId: shopA.id,
      buyerId: buyerA.id,
      productId: productASp01.id,
      qty: 2,
      unitPrice: 150_000,
      total: 300_000,
      status: "PENDING",
      eventId: "evt-a-pending",
      paymentCode: "pay-a-pending",
    },
  });
  const orderBForeign = await testPrisma.order.create({
    data: {
      code: 999,
      shopId: shopA.id,
      buyerId: buyerB.id,
      productId: productASp02.id,
      qty: 3,
      unitPrice: 220_000,
      total: 660_000,
      status: "SHIPPED",
      eventId: "evt-b-foreign",
      paymentCode: "pay-b-foreign",
    },
  });

  return {
    shopA: shopA.id,
    shopB: shopB.id,
    buyerA: buyerA.id,
    buyerB: buyerB.id,
    productASp01: productASp01.id,
    productASp02: productASp02.id,
    orderAPaid: { code: orderAPaid.code, total: orderAPaid.total },
    orderAPending: { code: orderAPending.code, total: orderAPending.total },
    orderBForeign: { code: orderBForeign.code, total: orderBForeign.total },
    kbA,
    kbB,
  };
}

describe("chat/ai — runner AI (template đơn + RAG + fallback)", () => {
  beforeEach(async () => {
    await resetDb();
    invalidateAllShopIndexes();
  });

  afterAll(async () => {
    invalidateAllShopIndexes();
    await testPrisma.$disconnect();
  });

  it("(a) hỏi đơn → template đơn MỚI NHẤT của chính buyer, không gọi Groq", async () => {
    const fx = await seedFixture();
    const fake = replyChat("không được dùng tới");
    const runner = createAiRunner({ chatCompletion: fake.chat, embedder: fakeEmbedder() });

    const answer = await runner.answer(testPrisma, {
      conversationId: "conv-a",
      shopId: fx.shopA,
      buyerId: fx.buyerA,
      text: "Đơn của mình sao rồi ạ?",
      history: [],
    });

    expect(answer.content).toContain(`#${fx.orderAPending.code}`);
    expect(answer.content).toContain("chờ thanh toán");
    expect(answer.content).toContain("Áo thun basic");
    expect(answer.content).toContain("300.000");
    expect(answer.content).toContain("QR"); // nhắc thanh toán cho đơn PENDING
    // Đơn PAID cũ hơn và đơn của buyer khác đều không được lộ.
    expect(answer.content).not.toContain("150.000");
    expect(answer.content).not.toContain(`#${fx.orderBForeign.code}`);
    expect(answer.content).not.toContain("660.000");

    expect(answer.trace.model).toBe("order-template");
    expect(answer.trace.tokens).toEqual({ prompt: 0, completion: 0 });
    expect(answer.trace.orderLookup).toEqual({
      code: fx.orderAPending.code,
      status: "PENDING",
      total: fx.orderAPending.total,
    });
    expect(answer.trace.topK).toEqual([]);
    expect(fake.calls).toHaveLength(0); // spec §4: câu hỏi đơn đi đường template, không qua Groq
  });

  it("(b) hỏi mã đơn của buyer khác (#999) → 'chưa thấy đơn', không lộ tổng tiền/sản phẩm/trạng thái của đơn kia", async () => {
    const fx = await seedFixture();
    const fake = replyChat("không được dùng tới");
    const runner = createAiRunner({ chatCompletion: fake.chat, embedder: fakeEmbedder() });

    const answer = await runner.answer(testPrisma, {
      conversationId: "conv-b",
      shopId: fx.shopA,
      buyerId: fx.buyerA,
      text: `Cho mình hỏi đơn #${fx.orderBForeign.code} bao giờ tới vậy shop?`,
      history: [],
    });

    expect(answer.content).toContain("chưa thấy đơn");
    // Truy vấn đã scope theo buyerId nên không mảnh dữ liệu nào của đơn kia lọt ra:
    // tổng tiền (cả dạng hiển thị lẫn dạng thô), tên sản phẩm, trạng thái, số lượng.
    expect(answer.content).not.toContain("660.000");
    expect(answer.content).not.toContain("660000");
    expect(answer.content).not.toContain("Quần jogger");
    expect(answer.content).not.toContain("đang giao");
    expect(answer.content).not.toContain("×3");
    expect(answer.trace.orderLookup).toBeUndefined();
    expect(fake.calls).toHaveLength(0);
  });

  it("(c) chat shop A nhắc SP01 → prompt/trace chỉ dùng dữ liệu shop A (không lẫn giá/tên shop B)", async () => {
    const fx = await seedFixture();
    const fake = replyChat("Dạ SP01 bên mình còn hàng nhé bạn!");
    const runner = createAiRunner({ chatCompletion: fake.chat, embedder: fakeEmbedder() });

    const question = "Shop ơi SP01 còn hàng không ạ?";
    const answer = await runner.answer(testPrisma, {
      conversationId: "conv-c",
      shopId: fx.shopA,
      buyerId: fx.buyerA,
      text: question,
      history: [],
    });

    // Nội dung do model trả về được chuyển nguyên văn, trace ghi lại lần gọi thật.
    expect(answer.content).toBe("Dạ SP01 bên mình còn hàng nhé bạn!");
    expect(answer.trace.model).toBe("fake-model");
    expect(answer.trace.tokens).toEqual({ prompt: 12, completion: 7 });
    expect(answer.trace.elapsedMs).toBeGreaterThanOrEqual(0);

    // Truy vết ghi TOÀN BỘ sản phẩm shop A (giá/kho đọc lúc trả lời): SP01 đúng
    // giá shop A (150.000); không có bản ghi nào của shop B (SP01 giá 200.000).
    expect(answer.trace.products).toEqual([
      { sku: "SP01", name: "Áo thun basic", price: 150_000, stock: 8 },
      { sku: "SP02", name: "Quần jogger", price: 220_000, stock: 5 },
    ]);

    // topK chỉ gồm entry của shop A (2 KB + 2 sản phẩm — index shop B không lọt vào).
    const topKIds = answer.trace.topK.map((entry) => entry.id).sort();
    expect(topKIds).toEqual(
      [fx.kbA[0].id, fx.kbA[1].id, fx.productASp01, fx.productASp02].sort(),
    );
    expect(
      answer.trace.topK.every(
        (entry) =>
          (entry.kind === "kb" || entry.kind === "product") &&
          typeof entry.score === "number",
      ),
    ).toBe(true);
    expect(answer.trace.liveSessionId).toBeUndefined(); // fixture chỉ có phiên ENDED

    // Prompt thật gửi cho model: đúng shop A, giá/kho sống, KB có answer từ DB…
    expect(fake.calls).toHaveLength(1);
    const messages = fake.calls[0];
    expect(messages[0].role).toBe("system");
    expect(messages[0].content).toContain("Shop Thời Trang Linh");
    expect(messages[0].content).toContain("Áo thun basic");
    expect(messages[0].content).toContain("150.000");
    expect(messages[0].content).toContain("Chọn size theo chiều cao và cân nặng.");
    // …không có dữ liệu shop B và không nhắc live khi phiên đã kết thúc.
    expect(messages[0].content).not.toContain("200.000");
    expect(messages[0].content).not.toContain("Áo sơ mi công sở");
    expect(messages[0].content).not.toContain("đang lên sóng");
    // Câu hỏi là message cuối cùng.
    expect(messages.at(-1)).toEqual({ role: "user", content: question });
  });

  it("(d) GroqError → xin lỗi + TOÀN BỘ KB của đúng shop, fallback FULL_KB kèm error", async () => {
    const fx = await seedFixture();
    const fake = createFakeChat(async () => {
      throw new GroqError("Groq quá thời gian chờ");
    });
    const runner = createAiRunner({ chatCompletion: fake.chat, embedder: fakeEmbedder() });

    const answer = await runner.answer(testPrisma, {
      conversationId: "conv-d",
      shopId: fx.shopA,
      buyerId: fx.buyerA,
      text: "Đổi trả thế nào ạ?",
      history: [],
    });

    expect(answer.content).toContain("xin lỗi");
    for (const kb of fx.kbA) {
      expect(answer.content).toContain(kb.title);
      expect(answer.content).toContain(kb.answer);
    }
    expect(answer.content).toContain("nhắn lại"); // nhắc khách quay lại sau
    // Fallback vẫn đúng shop: KB của shop B không được lọt vào.
    expect(answer.content).not.toContain(fx.kbB[0].title);
    expect(answer.content).not.toContain(fx.kbB[0].answer);

    expect(answer.trace.fallback).toBe("FULL_KB");
    expect(answer.trace.error).toContain("Groq quá thời gian chờ");
    expect(answer.trace.tokens).toEqual({ prompt: 0, completion: 0 });
    expect(answer.trace.topK.length).toBeGreaterThan(0); // truy vết lần truy hồi vẫn được ghi
  });

  it("(e) shop đang LIVE → prompt có 'đang lên sóng' + tiêu đề; history map BUYER/AI/SELLER, bỏ SYSTEM", async () => {
    const fx = await seedFixture();
    const live = await testPrisma.liveSession.create({
      data: { shopId: fx.shopA, title: "Live thời trang tối nay", status: "LIVE" },
    });
    const fake = replyChat("Dạ mời bạn vào xem live chốt đơn nha!");
    const runner = createAiRunner({ chatCompletion: fake.chat, embedder: fakeEmbedder() });

    const answer = await runner.answer(testPrisma, {
      conversationId: "conv-e",
      shopId: fx.shopA,
      buyerId: fx.buyerA,
      text: "Shop bán gì vậy?",
      history: [
        { source: "BUYER", content: "Chào shop" },
        { source: "SYSTEM", content: "Hệ thống: đã tạo đơn #2" },
        { source: "AI", content: "Chào bạn nhé" },
        { source: "SELLER", content: "Shop đang bán áo thun" },
      ],
    });

    expect(answer.trace.liveSessionId).toBe(live.id);
    expect(fake.calls).toHaveLength(1);
    const messages = fake.calls[0];
    expect(messages[0].role).toBe("system");
    expect(messages[0].content).toContain("đang lên sóng");
    expect(messages[0].content).toContain("Live thời trang tối nay");
    // Lịch sử: BUYER → user, AI/SELLER → assistant; SYSTEM bị bỏ (không phải lượt
    // hội thoại — thông tin đơn đã có đường template riêng).
    expect(messages.slice(1)).toEqual([
      { role: "user", content: "Chào shop" },
      { role: "assistant", content: "Chào bạn nhé" },
      { role: "assistant", content: "Shop đang bán áo thun" },
      { role: "user", content: "Shop bán gì vậy?" },
    ]);
  });

  it("lỗi KHÔNG phải GroqError được ném nguyên trạng (Task 7 xử lý) — không âm thầm fallback", async () => {
    const fx = await seedFixture();
    const fake = createFakeChat(async () => {
      throw new TypeError("bug lập trình");
    });
    const runner = createAiRunner({ chatCompletion: fake.chat, embedder: fakeEmbedder() });

    await expect(
      runner.answer(testPrisma, {
        conversationId: "conv-x",
        shopId: fx.shopA,
        buyerId: fx.buyerA,
        text: "Áo thun giá bao nhiêu?",
        history: [],
      }),
    ).rejects.toThrow("bug lập trình");
  });

  describe("readTrace — validate tối thiểu cho UI đọc từ JSON", () => {
    const valid: AiTrace = {
      model: "qwen/qwen3.8-27b",
      topK: [{ id: "e1", title: "Bảng size áo thun", kind: "kb", score: 0.87 }],
      products: [{ sku: "SP01", name: "Áo thun basic", price: 150_000, stock: 8 }],
      liveSessionId: "live-1",
      orderLookup: { code: 2, status: "PENDING", total: 300_000 },
      tokens: { prompt: 12, completion: 7 },
      elapsedMs: 42,
      fallback: "FULL_KB",
      error: "Groq quá thời gian chờ",
    };

    it("shape hợp lệ → trả nguyên trace; shape hỏng → null", () => {
      expect(readTrace(valid)).toEqual(valid);

      const broken: unknown[] = [
        null,
        undefined,
        "trace",
        42,
        {},
        { model: "x" }, // thiếu topK/products/tokens/elapsedMs
        { ...valid, topK: "không phải mảng" },
        { ...valid, topK: [{ id: "e1", title: "x", kind: "khác", score: 1 }] },
        { ...valid, products: [{ sku: "SP01", name: "Áo thun" }] }, // thiếu price/stock
        { ...valid, tokens: { prompt: "12", completion: 7 } },
        { ...valid, elapsedMs: "42" },
        { ...valid, fallback: "KHÁC" },
        { ...valid, error: 123 },
      ];
      for (const bad of broken) {
        expect(readTrace(bad)).toBeNull();
      }
    });
  });
});
