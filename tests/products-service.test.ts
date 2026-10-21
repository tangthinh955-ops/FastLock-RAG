import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { ApiError } from "../lib/auth/service";
import type { EmbedKind, Embedder } from "../lib/rag/embedder";
import { invalidateAllShopIndexes, retrieve } from "../lib/rag/index";
import {
  createProduct,
  deleteProduct,
  listShopProducts,
  parseProductInput,
  updateProduct,
} from "../lib/products/service";
import { resetDb, testPrisma } from "./helpers/db";

/**
 * Integration thật trên PostgreSQL test cho CRUD sản phẩm phía seller (Plan 3
 * T3): validate input, SKU unique theo shop, chặn thao tác chéo shop bằng cùng
 * một 404, xoá bị chặn khi sản phẩm đã có đơn, và invalidate index RAG sau mỗi
 * mutation để AI thấy tên/SKU mới ngay.
 *
 * Index RAG giữ trong RAM cấp process ⇒ `invalidateAllShopIndexes()` chạy trước
 * mỗi test (resetDb xoá DB nhưng không đụng RAM), đúng khuôn `rag-index.test.ts`.
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
  shopAId: string;
  shopBId: string;
  buyerId: string;
  /** Shop A: SP01 "Áo thun basic". */
  productAId: string;
  /** Shop B: cũng SP01 nhưng bản ghi riêng — SKU chỉ unique trong một shop. */
  productBId: string;
};

async function seedFixture(): Promise<Fixture> {
  const ownerA = await testPrisma.user.create({
    data: {
      email: "owner-products-a@test.vn",
      passwordHash: "x",
      name: "Chủ A",
      role: "SELLER",
    },
  });
  const ownerB = await testPrisma.user.create({
    data: {
      email: "owner-products-b@test.vn",
      passwordHash: "x",
      name: "Chủ B",
      role: "SELLER",
    },
  });
  const buyer = await testPrisma.user.create({
    data: {
      email: "buyer-products@test.vn",
      passwordHash: "x",
      name: "Khách Mua",
      role: "BUYER",
    },
  });
  const shopA = await testPrisma.shop.create({
    data: { name: "Shop A", ownerId: ownerA.id },
  });
  const shopB = await testPrisma.shop.create({
    data: { name: "Shop B", ownerId: ownerB.id },
  });
  const productA = await testPrisma.product.create({
    data: {
      shopId: shopA.id,
      sku: "SP01",
      name: "Áo thun basic",
      price: 150_000,
      stock: 8,
    },
  });
  const productB = await testPrisma.product.create({
    data: {
      shopId: shopB.id,
      sku: "SP01",
      name: "Áo shop B",
      price: 200_000,
      stock: 5,
    },
  });

  return {
    shopAId: shopA.id,
    shopBId: shopB.id,
    buyerId: buyer.id,
    productAId: productA.id,
    productBId: productB.id,
  };
}

let orderSeq = 0;

async function createOrderFor(fixture: Fixture, productId: string) {
  orderSeq += 1;
  return testPrisma.order.create({
    data: {
      shopId: fixture.shopAId,
      buyerId: fixture.buyerId,
      productId,
      qty: 1,
      unitPrice: 150_000,
      total: 150_000,
      eventId: `test-products-${orderSeq}`,
      paymentCode: `TESTPRODUCTS${orderSeq}`,
    },
  });
}

async function expectApiError(
  promise: Promise<unknown>,
  status: number,
): Promise<ApiError> {
  const error = await promise.catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(ApiError);
  const apiError = error as ApiError;
  expect(apiError.status).toBe(status);
  return apiError;
}

const VALID_INPUT = {
  sku: "SP02",
  name: "Quần jogger",
  price: 220_000,
  stock: 5,
  imageUrl: null,
};

describe("parseProductInput — chuẩn hoá + validate (Plan 3 T3)", () => {
  it("trim + upper SKU, trim tên; imageUrl null giữ null", () => {
    const parsed = parseProductInput({
      sku: "  sp02  ",
      name: "  Quần jogger  ",
      price: 220_000,
      stock: 5,
      imageUrl: null,
    });

    expect(parsed).toEqual({
      sku: "SP02",
      name: "Quần jogger",
      price: 220_000,
      stock: 5,
      imageUrl: null,
    });
  });

  it("imageUrl thiếu/undefined → null; đường dẫn /uploads/ hợp lệ được giữ", () => {
    const missing = parseProductInput({
      sku: "SP02",
      name: "Quần jogger",
      price: 1,
      stock: 0,
    });
    expect(missing.imageUrl).toBeNull();

    const uploaded = parseProductInput({
      ...VALID_INPUT,
      imageUrl: "/uploads/6f1c2a7b-1e2d-4c3b-9a8f-000000000000.webp",
    });
    expect(uploaded.imageUrl).toBe(
      "/uploads/6f1c2a7b-1e2d-4c3b-9a8f-000000000000.webp",
    );
  });

  it.each([
    ["rỗng", ""],
    ["chỉ khoảng trắng", "   "],
    ["1 ký tự", "A"],
    ["quá 20 ký tự", "A".repeat(21)],
    ["có khoảng trắng", "SP 01"],
    ["ký tự lạ", "SP@01"],
    ["bắt đầu bằng gạch ngang", "-SP01"],
    ["tiếng Việt có dấu", "ÁO01"],
  ])("SKU %s → 400", async (_label, sku) => {
    await expectApiError(
      Promise.resolve().then(() =>
        parseProductInput({ ...VALID_INPUT, sku }),
      ),
      400,
    );
  });

  it.each([
    ["rỗng", ""],
    ["toàn khoảng trắng", "   "],
    ["quá 120 ký tự", "a".repeat(121)],
  ])("tên %s → 400", async (_label, name) => {
    await expectApiError(
      Promise.resolve().then(() => parseProductInput({ ...VALID_INPUT, name })),
      400,
    );
  });

  it.each([
    ["âm", -1],
    ["không nguyên", 1.5],
    ["vượt trần", 100_000_001],
    ["chuỗi số", "1000"],
    ["NaN", Number.NaN],
  ])("price %s → 400", async (_label, price) => {
    await expectApiError(
      Promise.resolve().then(() =>
        parseProductInput({ ...VALID_INPUT, price }),
      ),
      400,
    );
  });

  it.each([
    ["âm", -1],
    ["không nguyên", 0.5],
    ["vượt trần", 100_001],
    ["chuỗi số", "5"],
  ])("stock %s → 400", async (_label, stock) => {
    await expectApiError(
      Promise.resolve().then(() =>
        parseProductInput({ ...VALID_INPUT, stock }),
      ),
      400,
    );
  });

  it.each([
    ["javascript:", "javascript:alert(1)"],
    ["đường dẫn tuyệt đối ngoài uploads", "/etc/passwd"],
    ["URL ngoài", "https://example.com/a.png"],
    ["path traversal", "/uploads/../secret.png"],
    ["chuỗi rỗng", ""],
  ])("imageUrl %s → 400", async (_label, imageUrl) => {
    await expectApiError(
      Promise.resolve().then(() =>
        parseProductInput({ ...VALID_INPUT, imageUrl }),
      ),
      400,
    );
  });

  it.each([
    ["null", null],
    ["mảng", []],
    ["thiếu trường", { sku: "SP02" }],
  ])("payload %s → 400", async (_label, value) => {
    await expectApiError(
      Promise.resolve().then(() => parseProductInput(value)),
      400,
    );
  });
});

describe("products/service — CRUD theo shop (Plan 3 T3)", () => {
  beforeEach(async () => {
    await resetDb();
    invalidateAllShopIndexes();
  });

  afterAll(async () => {
    invalidateAllShopIndexes();
    await testPrisma.$disconnect();
  });

  it("createProduct lưu input đã chuẩn hoá; listShopProducts sắp SKU tăng dần", async () => {
    const fixture = await seedFixture();

    const created = await createProduct(
      testPrisma,
      fixture.shopAId,
      parseProductInput({
        sku: "  sp02 ",
        name: "  Quần jogger ",
        price: 220_000,
        stock: 5,
        imageUrl: "/uploads/anh.webp",
      }),
    );

    expect(created).toMatchObject({
      shopId: fixture.shopAId,
      sku: "SP02",
      name: "Quần jogger",
      price: 220_000,
      stock: 5,
      imageUrl: "/uploads/anh.webp",
    });

    const list = await listShopProducts(testPrisma, fixture.shopAId);
    expect(list.map((product) => product.sku)).toEqual(["SP01", "SP02"]);
    expect(list.every((product) => product.shopId === fixture.shopAId)).toBe(
      true,
    );
    // Shop B không thấy sản phẩm mới của shop A.
    const listB = await listShopProducts(testPrisma, fixture.shopBId);
    expect(listB.map((product) => product.id)).toEqual([fixture.productBId]);
  });

  it("updateProduct đổi được tên/SKU/giá/kho/ảnh", async () => {
    const fixture = await seedFixture();

    const updated = await updateProduct(
      testPrisma,
      fixture.shopAId,
      fixture.productAId,
      parseProductInput({
        sku: "sp99",
        name: "Áo thun premium",
        price: 199_000,
        stock: 3,
        imageUrl: "/uploads/premium.png",
      }),
    );

    expect(updated).toMatchObject({
      id: fixture.productAId,
      sku: "SP99",
      name: "Áo thun premium",
      price: 199_000,
      stock: 3,
      imageUrl: "/uploads/premium.png",
    });
    const stored = await testPrisma.product.findUniqueOrThrow({
      where: { id: fixture.productAId },
    });
    expect(stored.sku).toBe("SP99");
  });

  it("shop B không sửa/xoá được sản phẩm shop A — CÙNG một 404, dữ liệu không đổi", async () => {
    const fixture = await seedFixture();

    const updateError = await expectApiError(
      updateProduct(
        testPrisma,
        fixture.shopBId,
        fixture.productAId,
        parseProductInput(VALID_INPUT),
      ),
      404,
    );
    expect(updateError.message).toBe("Không tìm thấy sản phẩm của shop bạn");

    const deleteError = await expectApiError(
      deleteProduct(testPrisma, fixture.shopBId, fixture.productAId),
      404,
    );
    expect(deleteError.message).toBe("Không tìm thấy sản phẩm của shop bạn");

    const stored = await testPrisma.product.findUniqueOrThrow({
      where: { id: fixture.productAId },
    });
    expect(stored.sku).toBe("SP01");
    expect(stored.name).toBe("Áo thun basic");
  });

  it("id không tồn tại → 404 cùng thông điệp", async () => {
    const fixture = await seedFixture();

    const error = await expectApiError(
      updateProduct(
        testPrisma,
        fixture.shopAId,
        "00000000-0000-4000-8000-000000000000",
        parseProductInput(VALID_INPUT),
      ),
      404,
    );
    expect(error.message).toBe("Không tìm thấy sản phẩm của shop bạn");
  });

  it("trùng SKU trong cùng shop → 409; cùng SKU ở hai shop khác nhau OK", async () => {
    const fixture = await seedFixture();

    const duplicateCreate = await expectApiError(
      createProduct(
        testPrisma,
        fixture.shopAId,
        parseProductInput({ ...VALID_INPUT, sku: "sp01" }),
      ),
      409,
    );
    expect(duplicateCreate.message).toBe("SKU đã có trong shop này");

    // Shop B đã có SP01 riêng — tạo SP01 ở shop A vẫn phải 409 dù B có.
    const countA = await testPrisma.product.count({
      where: { shopId: fixture.shopAId },
    });
    expect(countA).toBe(1);

    // Cùng SKU "SP02" ở hai shop khác nhau đều tạo được.
    const createdA = await createProduct(
      testPrisma,
      fixture.shopAId,
      parseProductInput(VALID_INPUT),
    );
    const createdB = await createProduct(
      testPrisma,
      fixture.shopBId,
      parseProductInput(VALID_INPUT),
    );
    expect(createdA.sku).toBe("SP02");
    expect(createdB.sku).toBe("SP02");
    expect(createdA.shopId).toBe(fixture.shopAId);
    expect(createdB.shopId).toBe(fixture.shopBId);
  });

  it("update đổi SKU sang SKU đã có trong shop → 409, bản ghi giữ nguyên", async () => {
    const fixture = await seedFixture();
    await createProduct(
      testPrisma,
      fixture.shopAId,
      parseProductInput({ ...VALID_INPUT, sku: "SP02" }),
    );

    const error = await expectApiError(
      updateProduct(
        testPrisma,
        fixture.shopAId,
        fixture.productAId,
        parseProductInput({ ...VALID_INPUT, sku: "SP02" }),
      ),
      409,
    );
    expect(error.message).toBe("SKU đã có trong shop này");

    const stored = await testPrisma.product.findUniqueOrThrow({
      where: { id: fixture.productAId },
    });
    expect(stored.sku).toBe("SP01");
  });

  it("deleteProduct xoá được sản phẩm chưa có đơn", async () => {
    const fixture = await seedFixture();

    await deleteProduct(testPrisma, fixture.shopAId, fixture.productAId);

    expect(
      await testPrisma.product.findUnique({
        where: { id: fixture.productAId },
      }),
    ).toBeNull();
    // Sản phẩm shop B còn nguyên.
    expect(
      await testPrisma.product.findUnique({
        where: { id: fixture.productBId },
      }),
    ).not.toBeNull();
  });

  it("deleteProduct sản phẩm đã có đơn → 409, sản phẩm còn nguyên", async () => {
    const fixture = await seedFixture();
    await createOrderFor(fixture, fixture.productAId);

    const error = await expectApiError(
      deleteProduct(testPrisma, fixture.shopAId, fixture.productAId),
      409,
    );
    expect(error.message).toBe("Sản phẩm đã có đơn — không xoá được");

    expect(
      await testPrisma.product.findUnique({
        where: { id: fixture.productAId },
      }),
    ).not.toBeNull();
  });
});

describe("products/service — invalidate RAG sau mutation (Plan 3 T3)", () => {
  beforeEach(async () => {
    await resetDb();
    invalidateAllShopIndexes();
  });

  afterAll(async () => {
    invalidateAllShopIndexes();
    await testPrisma.$disconnect();
  });

  it("update đổi tên + SKU → retrieve lần sau thấy tên/SKU mới (index dựng lại)", async () => {
    const fixture = await seedFixture();
    const kb = await testPrisma.kbEntry.create({
      data: {
        shopId: fixture.shopAId,
        title: "Bảng size áo",
        answer: "Chọn size theo chiều cao.",
      },
    });
    const fake = createFakeEmbedder();

    // Lần đầu: index dựng từ DB và giữ trong RAM.
    const before = await retrieve(testPrisma, fixture.shopAId, "áo thun basic", {
      embedder: fake.embedder,
    });
    expect(before.meta).toMatchObject({ kbCount: 1, productCount: 1 });
    expect(before.entries[0]).toMatchObject({
      id: fixture.productAId,
      kind: "product",
      title: "Áo thun basic",
      sku: "SP01",
    });

    await new Promise((resolve) => setTimeout(resolve, 5)); // builtAt đổi được (ISO ms)

    await updateProduct(
      testPrisma,
      fixture.shopAId,
      fixture.productAId,
      parseProductInput({
        sku: "ao02",
        name: "Áo thun premium",
        price: 199_000,
        stock: 3,
        imageUrl: null,
      }),
    );

    // Index đã bị xoá ⇒ retrieve dựng lại và thấy tên/SKU mới ngay.
    const after = await retrieve(
      testPrisma,
      fixture.shopAId,
      "áo thun premium",
      { embedder: fake.embedder },
    );
    expect(after.meta.builtAt).not.toBe(before.meta.builtAt);
    expect(after.meta).toMatchObject({ kbCount: 1, productCount: 1 });
    expect(after.entries[0]).toMatchObject({
      id: fixture.productAId,
      kind: "product",
      title: "Áo thun premium",
      sku: "AO02",
    });
    expect(after.entries.map((entry) => entry.title)).toContain("Bảng size áo");
    expect(
      fake.calls.some((call) =>
        call.texts.includes("Sản phẩm Áo thun premium (mã AO02)"),
      ),
    ).toBe(true);
    // Entry KB vẫn còn trong index mới.
    expect(after.entries.map((entry) => entry.id)).toContain(kb.id);
  });

  it("create/delete cũng invalidate — retrieve thấy sản phẩm mới rồi mất đi", async () => {
    const fixture = await seedFixture();
    const fake = createFakeEmbedder();

    const before = await retrieve(testPrisma, fixture.shopAId, "áo thun basic", {
      embedder: fake.embedder,
    });
    expect(before.meta.productCount).toBe(1);

    const created = await createProduct(
      testPrisma,
      fixture.shopAId,
      parseProductInput({ ...VALID_INPUT, sku: "SP02", name: "Quần jogger" }),
    );
    const withNew = await retrieve(
      testPrisma,
      fixture.shopAId,
      "quần jogger",
      { embedder: fake.embedder },
    );
    expect(withNew.meta.productCount).toBe(2);
    expect(withNew.entries.map((entry) => entry.id)).toContain(created.id);

    await deleteProduct(testPrisma, fixture.shopAId, created.id);
    const afterDelete = await retrieve(
      testPrisma,
      fixture.shopAId,
      "quần jogger",
      { embedder: fake.embedder },
    );
    expect(afterDelete.meta.productCount).toBe(1);
    expect(afterDelete.entries.map((entry) => entry.id)).not.toContain(
      created.id,
    );
  });
});
