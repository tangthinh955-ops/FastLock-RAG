import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  EMBEDDING_MODEL_ID,
  EMBEDDING_MODEL_REVISION,
  type EmbedKind,
  type Embedder,
} from "../lib/rag/embedder";
import {
  findExactSku,
  invalidateAllShopIndexes,
  invalidateShopIndex,
  retrieve,
} from "../lib/rag/index";
import { resetDb, testPrisma } from "./helpers/db";

/**
 * Integration thật trên PostgreSQL test — index RAM là singleton mức process
 * (globalThis) nên `invalidateAllShopIndexes` chạy trước mỗi test để không rò
 * rỉ index của test trước (resetDb xoá DB nhưng không đụng RAM).
 */

/**
 * Embedder giả tất định: bag-of-tokens một chiều, 384 chiều (cùng số chiều
 * e5-small thật).
 *
 * Mỗi token (bỏ dấu câu, lower-case) băm FNV-1a vào một chiều cố định rồi
 * L2-normalize — cùng quy ước "vector đã normalize" của embedder thật
 * (`embed(..., { normalize: true })`), nên điểm = tích vô hướng. Nhờ vậy xếp
 * hạng suy trực tiếp từ số token trùng giữa câu hỏi và passage: test assert
 * được thứ hạng cụ thể (top-1, điểm giảm dần), không phải "có kết quả là được".
 * `calls` ghi lại nguyên văn text/kind mà `retrieve` đưa vào embedder — dùng để
 * chứng minh text vector không chứa giá/kho và không gọi embedder thừa.
 */
const FAKE_DIM = 384;

type FakeEmbedder = {
  embedder: Embedder;
  calls: Array<{ kind: EmbedKind; texts: string[] }>;
};

function tokenIndex(token: string): number {
  let hash = 2166136261;
  for (let i = 0; i < token.length; i += 1) {
    hash ^= token.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % FAKE_DIM;
}

function fakeVector(text: string): number[] {
  const vector = new Array<number>(FAKE_DIM).fill(0);
  for (const token of text.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (token !== "") {
      vector[tokenIndex(token)] += 1;
    }
  }
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  return vector.map((value) => value / norm);
}

function createFakeEmbedder(): FakeEmbedder {
  const calls: FakeEmbedder["calls"] = [];
  return {
    calls,
    embedder: {
      async embed(texts, kind) {
        calls.push({ kind, texts: [...texts] });
        return texts.map(fakeVector);
      },
    },
  };
}

type Fixture = {
  shopA: string;
  shopB: string;
  /** Shop A: SP01 "Áo thun basic" + SP02 "Quần jogger". */
  productASp01: string;
  productASp02: string;
  /** Shop B: SP01 trùng mã nhưng bản ghi riêng + SP03 chỉ shop B có. */
  productBSp01: string;
  productBSp03: string;
  /** Hai shop có KB cùng chủ đề "đổi trả" (như seed thật) — để thử lẫn shop. */
  kbAThun: string;
  kbAReturn: string;
  kbBReturn: string;
  kbBShip: string;
};

/** Dữ liệu tối thiểu cho các test: 2 shop, SKU trùng/hai chiều, KB trùng chủ đề. */
async function seedFixture(): Promise<Fixture> {
  const ownerA = await testPrisma.user.create({
    data: { email: "owner-a@test.vn", passwordHash: "x", name: "Chủ A", role: "SELLER" },
  });
  const ownerB = await testPrisma.user.create({
    data: { email: "owner-b@test.vn", passwordHash: "x", name: "Chủ B", role: "SELLER" },
  });
  const shopA = await testPrisma.shop.create({
    data: { name: "Shop A", ownerId: ownerA.id },
  });
  const shopB = await testPrisma.shop.create({
    data: { name: "Shop B", ownerId: ownerB.id },
  });

  const productASp01 = await testPrisma.product.create({
    data: { shopId: shopA.id, sku: "SP01", name: "Áo thun basic", price: 150_000, stock: 8 },
  });
  const productASp02 = await testPrisma.product.create({
    data: { shopId: shopA.id, sku: "SP02", name: "Quần jogger", price: 220_000, stock: 5 },
  });
  const productBSp01 = await testPrisma.product.create({
    data: { shopId: shopB.id, sku: "SP01", name: "Áo sơ mi công sở", price: 200_000, stock: 5 },
  });
  const productBSp03 = await testPrisma.product.create({
    data: { shopId: shopB.id, sku: "SP03", name: "Thắt lưng da", price: 180_000, stock: 6 },
  });

  const kbAThun = await testPrisma.kbEntry.create({
    data: {
      shopId: shopA.id,
      title: "Bảng size áo thun",
      answer: "Chọn size theo chiều cao và cân nặng.",
    },
  });
  const kbAReturn = await testPrisma.kbEntry.create({
    data: {
      shopId: shopA.id,
      title: "Chính sách đổi trả",
      answer: "Đổi trả trong 7 ngày nếu còn tag.",
    },
  });
  const kbBReturn = await testPrisma.kbEntry.create({
    data: {
      shopId: shopB.id,
      title: "Chính sách đổi trả",
      answer: "Đổi trả trong 3 ngày, quá hạn không nhận.",
    },
  });
  const kbBShip = await testPrisma.kbEntry.create({
    data: { shopId: shopB.id, title: "Phí ship", answer: "Tính phí theo khu vực giao hàng." },
  });

  return {
    shopA: shopA.id,
    shopB: shopB.id,
    productASp01: productASp01.id,
    productASp02: productASp02.id,
    productBSp01: productBSp01.id,
    productBSp03: productBSp03.id,
    kbAThun: kbAThun.id,
    kbAReturn: kbAReturn.id,
    kbBReturn: kbBReturn.id,
    kbBShip: kbBShip.id,
  };
}

describe("rag/index — index RAM theo shop + retrieve top-k", () => {
  beforeEach(async () => {
    await resetDb();
    invalidateAllShopIndexes();
  });

  afterAll(async () => {
    invalidateAllShopIndexes();
    await testPrisma.$disconnect();
  });

  it("(a) retrieve trả KB đúng shop — shop B có KB cùng tiêu đề cũng không lẫn vào", async () => {
    const fx = await seedFixture();
    const { embedder } = createFakeEmbedder();

    const { entries, meta } = await retrieve(testPrisma, fx.shopA, "đổi trả mấy ngày", {
      embedder,
    });

    expect(meta).toMatchObject({
      shopId: fx.shopA,
      modelId: EMBEDDING_MODEL_ID,
      revision: EMBEDDING_MODEL_REVISION,
      kbCount: 2,
      productCount: 2,
    });
    expect(Number.isNaN(Date.parse(meta.builtAt))).toBe(false); // builtAt là ISO string

    // Top-1 là KB "Chính sách đổi trả" của shop A; điểm sắp giảm dần.
    expect(entries).toHaveLength(4); // 2 KB + 2 sản phẩm, topK mặc định 5
    expect(entries[0]).toMatchObject({
      id: fx.kbAReturn,
      kind: "kb",
      title: "Chính sách đổi trả",
    });
    expect(entries[0].score).toBeGreaterThan(entries[1].score);
    const scores = entries.map((entry) => entry.score);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));

    // Không một entry nào của shop B (dù B có KB tiêu đề y hệt).
    const ids = entries.map((entry) => entry.id);
    for (const foreign of [fx.kbBReturn, fx.kbBShip, fx.productBSp01, fx.productBSp03]) {
      expect(ids).not.toContain(foreign);
    }

    // Chiều ngược lại: hỏi shop B → chỉ entry của B, top-1 là KB đổi trả của B.
    const shopB = await retrieve(testPrisma, fx.shopB, "đổi trả mấy ngày", { embedder });
    expect(shopB.entries).toHaveLength(4);
    expect(shopB.entries[0]).toMatchObject({ id: fx.kbBReturn, kind: "kb" });
    expect(shopB.meta).toMatchObject({ shopId: fx.shopB, kbCount: 2, productCount: 2 });

    // topK cắt sau khi sort: topK 1 → đúng entry dẫn đầu.
    const top1 = await retrieve(testPrisma, fx.shopA, "đổi trả mấy ngày", {
      embedder,
      topK: 1,
    });
    expect(top1.entries).toHaveLength(1);
    expect(top1.entries[0].id).toBe(fx.kbAReturn);
  });

  it("(b) text vector sản phẩm không chứa giá/kho — đổi giá + kho, rebuild vẫn cho đúng kết quả", async () => {
    const fx = await seedFixture();
    const fake = createFakeEmbedder();

    const first = await retrieve(testPrisma, fx.shopA, "áo thun basic", {
      embedder: fake.embedder,
    });

    // Lần dựng đầu: MỘT call passage (toàn bộ KB + sản phẩm) rồi MỘT call query.
    expect(fake.calls.map((call) => call.kind)).toEqual(["passage", "query"]);
    expect(fake.calls[1].texts).toEqual(["áo thun basic"]);
    const passages = fake.calls[0].texts;
    // Đúng hợp đồng text vector: KB = "{title}\n{answer}", sản phẩm = "Sản phẩm {name} (mã {sku})".
    expect(passages).toContain("Bảng size áo thun\nChọn size theo chiều cao và cân nặng.");
    expect(passages).toContain("Chính sách đổi trả\nĐổi trả trong 7 ngày nếu còn tag.");
    expect(passages).toContain("Sản phẩm Áo thun basic (mã SP01)");
    // Giá/kho tuyệt đối không được lọt vào bất kỳ text vector nào (spec §4).
    for (const text of passages) {
      expect(text).not.toContain("150000");
      expect(text).not.toContain("150.000");
      expect(text).not.toContain("220000");
    }

    // Query khớp sản phẩm → sản phẩm đứng đầu (không có KB nào trùng nhiều hơn).
    expect(first.entries[0]).toMatchObject({
      id: fx.productASp01,
      kind: "product",
      title: "Áo thun basic",
      sku: "SP01",
    });
    expect(first.entries[0].score).toBeGreaterThan(first.entries[1].score);

    // Đổi giá + kho trong DB (dữ liệu chỉ dùng lúc dựng prompt, không vào vector).
    await new Promise((resolve) => setTimeout(resolve, 5)); // chắc chắn builtAt đổi (ISO ms)
    await testPrisma.product.update({
      where: { id: fx.productASp01 },
      data: { price: 999_999, stock: 777 },
    });

    const stale = await retrieve(testPrisma, fx.shopA, "áo thun basic", {
      embedder: fake.embedder,
    });
    // Chưa invalidate → index cũ phục vụ nguyên trạng.
    expect(stale.meta.builtAt).toBe(first.meta.builtAt);
    expect(fake.calls).toHaveLength(3); // chỉ thêm 1 call query, không rebuild

    invalidateShopIndex(fx.shopA);
    const rebuilt = await retrieve(testPrisma, fx.shopA, "áo thun basic", {
      embedder: fake.embedder,
    });

    // builtAt mới chứng minh dựng lại; text vector y nguyên (giá/kho không vào vector).
    expect(rebuilt.meta.builtAt).not.toBe(first.meta.builtAt);
    expect(fake.calls).toHaveLength(5);
    expect(fake.calls[3].texts).toEqual(passages);
    for (const text of fake.calls[3].texts) {
      expect(text).not.toContain("999999");
      expect(text).not.toContain("999.999");
      expect(text).not.toContain("777");
    }

    // Kết quả vẫn đúng: cùng sản phẩm đứng đầu, điểm y hệt (vector không đổi).
    expect(rebuilt.entries[0]).toMatchObject({ id: fx.productASp01, sku: "SP01" });
    expect(rebuilt.entries[0].score).toBeCloseTo(first.entries[0].score, 12);
    expect(rebuilt.meta.productCount).toBe(2);
  });

  it("(c) invalidate ép dựng lại — KB thêm vào DB chỉ xuất hiện sau invalidate", async () => {
    const fx = await seedFixture();
    const fake = createFakeEmbedder();

    const before = await retrieve(testPrisma, fx.shopA, "đổi trả", { embedder: fake.embedder });
    expect(before.meta.kbCount).toBe(2);
    expect(fake.calls).toHaveLength(2); // build + query

    const added = await testPrisma.kbEntry.create({
      data: {
        shopId: fx.shopA,
        title: "Khuyến mãi",
        answer: "Giảm giá 10% cho mọi đơn hàng.",
      },
    });

    // Chưa invalidate: index RAM cũ vẫn nguyên — KB mới chưa thấy, không rebuild.
    const stale = await retrieve(testPrisma, fx.shopA, "khuyến mãi giảm giá", {
      embedder: fake.embedder,
    });
    expect(fake.calls).toHaveLength(3);
    expect(stale.meta.builtAt).toBe(before.meta.builtAt);
    expect(stale.meta.kbCount).toBe(2);
    expect(stale.entries.map((entry) => entry.id)).not.toContain(added.id);

    // Sau invalidate: dựng lại từ DB → KB mới xuất hiện và khớp câu hỏi nhất.
    invalidateShopIndex(fx.shopA);
    const rebuilt = await retrieve(testPrisma, fx.shopA, "khuyến mãi giảm giá", {
      embedder: fake.embedder,
    });
    expect(fake.calls).toHaveLength(5);
    expect(rebuilt.meta.builtAt).not.toBe(before.meta.builtAt);
    expect(rebuilt.meta.kbCount).toBe(3);
    expect(rebuilt.entries[0]).toMatchObject({ id: added.id, kind: "kb", title: "Khuyến mãi" });
  });

  it("(d) findExactSku tra chính xác theo shop, không phân biệt hoa/thường; shop khác trả null", async () => {
    const fx = await seedFixture();

    // Input thường "sp01" → upper-case rồi tra trong shop A.
    const aSp01 = await findExactSku(testPrisma, fx.shopA, "sp01");
    expect(aSp01?.id).toBe(fx.productASp01);
    expect(aSp01?.name).toBe("Áo thun basic");

    // Cùng mã SP01 tồn tại ở cả hai shop → trả bản ghi CỦA SHOP ĐƯỢC HỎI.
    const bSp01 = await findExactSku(testPrisma, fx.shopB, "SP01");
    expect(bSp01?.id).toBe(fx.productBSp01);
    expect(bSp01?.name).toBe("Áo sơ mi công sở");

    // SKU không thuộc shop được hỏi → null (kể cả khi shop khác có).
    expect(await findExactSku(testPrisma, fx.shopB, "sp02")).toBeNull(); // SP02 chỉ shop A có
    expect(await findExactSku(testPrisma, fx.shopA, "sp03")).toBeNull(); // SP03 chỉ shop B có
  });

  it("invalidateAllShopIndexes xoá index của MỌI shop (cách ly giữa các test)", async () => {
    const fx = await seedFixture();
    const fake = createFakeEmbedder();

    const firstA = await retrieve(testPrisma, fx.shopA, "đổi trả", { embedder: fake.embedder });
    const firstB = await retrieve(testPrisma, fx.shopB, "đổi trả", { embedder: fake.embedder });

    invalidateAllShopIndexes();

    const secondA = await retrieve(testPrisma, fx.shopA, "đổi trả", { embedder: fake.embedder });
    const secondB = await retrieve(testPrisma, fx.shopB, "đổi trả", { embedder: fake.embedder });

    // Cả hai shop đều bị xoá → lần retrieve kế tiếp dựng lại từ DB (builtAt mới).
    expect(secondA.meta.builtAt).not.toBe(firstA.meta.builtAt);
    expect(secondB.meta.builtAt).not.toBe(firstB.meta.builtAt);
    expect(secondA.entries[0].id).toBe(fx.kbAReturn);
    expect(secondB.entries[0].id).toBe(fx.kbBReturn);
  });
});
