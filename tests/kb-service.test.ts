import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { ApiError } from "../lib/auth/service";
import type { EmbedKind, Embedder } from "../lib/rag/embedder";
import { invalidateAllShopIndexes, retrieve } from "../lib/rag/index";
import {
  createKbEntry,
  deleteKbEntry,
  listShopKb,
  parseKbInput,
  updateKbEntry,
} from "../lib/kb/service";
import { resetDb, testPrisma } from "./helpers/db";

/**
 * Integration thật trên PostgreSQL test cho CRUD mục kiến thức (Plan 3 T4):
 * validate input, danh sách theo `updatedAt desc`, chặn thao tác chéo shop bằng
 * CÙNG một 404, và invalidate index RAG sau mỗi mutation để AI trả lời bằng nội
 * dung mới ngay ở câu hỏi kế tiếp (spec §4/§12).
 *
 * Index RAG giữ trong RAM cấp process ⇒ `invalidateAllShopIndexes()` chạy trước
 * mỗi test (resetDb xoá DB nhưng không đụng RAM), đúng khuôn
 * `products-service.test.ts` / `rag-index.test.ts`.
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
  /** Shop A: "Chính sách đổi trả". */
  entryAId: string;
  /** Shop B: cùng tiêu đề nhưng bản ghi riêng — KB không có unique constraint. */
  entryBId: string;
};

async function seedFixture(): Promise<Fixture> {
  const ownerA = await testPrisma.user.create({
    data: {
      email: "owner-kb-a@test.vn",
      passwordHash: "x",
      name: "Chủ A",
      role: "SELLER",
    },
  });
  const ownerB = await testPrisma.user.create({
    data: {
      email: "owner-kb-b@test.vn",
      passwordHash: "x",
      name: "Chủ B",
      role: "SELLER",
    },
  });
  const shopA = await testPrisma.shop.create({
    data: { name: "Shop A", ownerId: ownerA.id },
  });
  const shopB = await testPrisma.shop.create({
    data: { name: "Shop B", ownerId: ownerB.id },
  });
  const entryA = await testPrisma.kbEntry.create({
    data: {
      shopId: shopA.id,
      title: "Chính sách đổi trả",
      answer: "Đổi trả trong 7 ngày nếu còn tag.",
    },
  });
  const entryB = await testPrisma.kbEntry.create({
    data: {
      shopId: shopB.id,
      title: "Chính sách đổi trả",
      answer: "Đổi trả trong 3 ngày, quá hạn không nhận.",
    },
  });

  return {
    shopAId: shopA.id,
    shopBId: shopB.id,
    entryAId: entryA.id,
    entryBId: entryB.id,
  };
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
  title: "Bảng size áo",
  answer: "Chọn size theo chiều cao và cân nặng.",
};

describe("parseKbInput — chuẩn hoá + validate (Plan 3 T4)", () => {
  it("trim tiêu đề và nội dung trả lời", () => {
    const parsed = parseKbInput({
      title: "  Bảng size áo  ",
      answer: "  Chọn size theo chiều cao.  ",
    });

    expect(parsed).toEqual({
      title: "Bảng size áo",
      answer: "Chọn size theo chiều cao.",
    });
  });

  it("nhận đúng biên 120 ký tự tiêu đề và 4000 ký tự trả lời", () => {
    const parsed = parseKbInput({
      title: "a".repeat(120),
      answer: "b".repeat(4000),
    });

    expect(parsed.title).toHaveLength(120);
    expect(parsed.answer).toHaveLength(4000);
  });

  it.each([
    ["rỗng", ""],
    ["toàn khoảng trắng", "   "],
    ["quá 120 ký tự", "a".repeat(121)],
    ["không phải chuỗi", 42],
    ["thiếu trường", undefined],
  ])("tiêu đề %s → 400", async (_label, title) => {
    const error = await expectApiError(
      Promise.resolve().then(() => parseKbInput({ ...VALID_INPUT, title })),
      400,
    );
    expect(error.message).toBe("Tiêu đề phải từ 1 đến 120 ký tự");
  });

  it.each([
    ["rỗng", ""],
    ["toàn khoảng trắng", "   "],
    ["quá 4000 ký tự", "a".repeat(4001)],
    ["không phải chuỗi", 42],
    ["thiếu trường", undefined],
  ])("nội dung trả lời %s → 400", async (_label, answer) => {
    const error = await expectApiError(
      Promise.resolve().then(() => parseKbInput({ ...VALID_INPUT, answer })),
      400,
    );
    expect(error.message).toBe(
      "Nội dung trả lời phải từ 1 đến 4000 ký tự",
    );
  });

  it.each([
    ["null", null],
    ["mảng", []],
    ["chuỗi", "abc"],
  ])("payload %s → 400", async (_label, value) => {
    const error = await expectApiError(
      Promise.resolve().then(() => parseKbInput(value)),
      400,
    );
    expect(error.message).toBe("Dữ liệu mục kiến thức không hợp lệ");
  });
});

describe("kb/service — CRUD theo shop (Plan 3 T4)", () => {
  beforeEach(async () => {
    await resetDb();
    invalidateAllShopIndexes();
  });

  afterAll(async () => {
    invalidateAllShopIndexes();
    await testPrisma.$disconnect();
  });

  it("createKbEntry lưu đúng shop + input đã chuẩn hoá; listShopKb chỉ trả của shop đó", async () => {
    const fixture = await seedFixture();

    const created = await createKbEntry(
      testPrisma,
      fixture.shopAId,
      parseKbInput({
        title: "  Phí ship  ",
        answer: "  Miễn phí ship cho đơn từ 500k.  ",
      }),
    );

    expect(created).toMatchObject({
      shopId: fixture.shopAId,
      title: "Phí ship",
      answer: "Miễn phí ship cho đơn từ 500k.",
    });

    const listA = await listShopKb(testPrisma, fixture.shopAId);
    expect(listA.map((entry) => entry.id)).toContain(created.id);
    expect(listA.every((entry) => entry.shopId === fixture.shopAId)).toBe(true);

    // Shop B không thấy mục mới của shop A.
    const listB = await listShopKb(testPrisma, fixture.shopBId);
    expect(listB.map((entry) => entry.id)).toEqual([fixture.entryBId]);
  });

  it("listShopKb sắp theo updatedAt giảm dần", async () => {
    const fixture = await seedFixture();
    await new Promise((resolve) => setTimeout(resolve, 5));

    const newer = await createKbEntry(
      testPrisma,
      fixture.shopAId,
      parseKbInput(VALID_INPUT),
    );
    // Vừa tạo đã mới nhất; sửa entry cũ để nó nhảy lên đầu.
    let list = await listShopKb(testPrisma, fixture.shopAId);
    expect(list.map((entry) => entry.id)).toEqual([
      newer.id,
      fixture.entryAId,
    ]);

    await new Promise((resolve) => setTimeout(resolve, 5));
    await updateKbEntry(
      testPrisma,
      fixture.shopAId,
      fixture.entryAId,
      parseKbInput({ ...VALID_INPUT, title: "Chính sách đổi trả mới" }),
    );

    list = await listShopKb(testPrisma, fixture.shopAId);
    expect(list.map((entry) => entry.id)).toEqual([
      fixture.entryAId,
      newer.id,
    ]);
  });

  it("updateKbEntry đổi được tiêu đề/nội dung, giữ nguyên shop", async () => {
    const fixture = await seedFixture();

    const updated = await updateKbEntry(
      testPrisma,
      fixture.shopAId,
      fixture.entryAId,
      parseKbInput({
        title: "Đổi trả 7 ngày",
        answer: "Gửi lại hàng trong 7 ngày, miễn phí đổi size.",
      }),
    );

    expect(updated).toMatchObject({
      id: fixture.entryAId,
      shopId: fixture.shopAId,
      title: "Đổi trả 7 ngày",
      answer: "Gửi lại hàng trong 7 ngày, miễn phí đổi size.",
    });

    const stored = await testPrisma.kbEntry.findUniqueOrThrow({
      where: { id: fixture.entryAId },
    });
    expect(stored.title).toBe("Đổi trả 7 ngày");
  });

  it("shop B không sửa/xoá được mục shop A — CÙNG một 404, dữ liệu không đổi", async () => {
    const fixture = await seedFixture();

    const updateError = await expectApiError(
      updateKbEntry(
        testPrisma,
        fixture.shopBId,
        fixture.entryAId,
        parseKbInput(VALID_INPUT),
      ),
      404,
    );
    expect(updateError.message).toBe(
      "Không tìm thấy mục kiến thức của shop bạn",
    );

    const deleteError = await expectApiError(
      deleteKbEntry(testPrisma, fixture.shopBId, fixture.entryAId),
      404,
    );
    expect(deleteError.message).toBe(
      "Không tìm thấy mục kiến thức của shop bạn",
    );

    const stored = await testPrisma.kbEntry.findUniqueOrThrow({
      where: { id: fixture.entryAId },
    });
    expect(stored.title).toBe("Chính sách đổi trả");
    expect(stored.answer).toBe("Đổi trả trong 7 ngày nếu còn tag.");
  });

  it("id không tồn tại → 404 cùng thông điệp (update + delete)", async () => {
    const fixture = await seedFixture();
    const missingId = "00000000-0000-4000-8000-000000000000";

    const updateError = await expectApiError(
      updateKbEntry(
        testPrisma,
        fixture.shopAId,
        missingId,
        parseKbInput(VALID_INPUT),
      ),
      404,
    );
    expect(updateError.message).toBe(
      "Không tìm thấy mục kiến thức của shop bạn",
    );

    const deleteError = await expectApiError(
      deleteKbEntry(testPrisma, fixture.shopAId, missingId),
      404,
    );
    expect(deleteError.message).toBe(
      "Không tìm thấy mục kiến thức của shop bạn",
    );
  });

  it("deleteKbEntry luôn xoá được (không có FK tham chiếu), không đụng shop khác", async () => {
    const fixture = await seedFixture();

    await deleteKbEntry(testPrisma, fixture.shopAId, fixture.entryAId);

    expect(
      await testPrisma.kbEntry.findUnique({ where: { id: fixture.entryAId } }),
    ).toBeNull();
    expect(
      await testPrisma.kbEntry.findUnique({ where: { id: fixture.entryBId } }),
    ).not.toBeNull();
  });
});

describe("kb/service — invalidate RAG: sửa KB là AI trả lời khác ngay (Plan 3 T4)", () => {
  beforeEach(async () => {
    await resetDb();
    invalidateAllShopIndexes();
  });

  afterAll(async () => {
    invalidateAllShopIndexes();
    await testPrisma.$disconnect();
  });

  it("create → retrieve thấy entry; update đổi tiêu đề → mất tiêu đề cũ, thấy tiêu đề mới", async () => {
    const fixture = await seedFixture();
    const fake = createFakeEmbedder();

    // Index dựng từ DB hiện tại (1 entry "Chính sách đổi trả").
    const before = await retrieve(
      testPrisma,
      fixture.shopAId,
      "Chính sách đổi trả",
      { embedder: fake.embedder },
    );
    expect(before.meta.kbCount).toBe(1);
    expect(before.entries.map((entry) => entry.id)).toEqual([
      fixture.entryAId,
    ]);

    await new Promise((resolve) => setTimeout(resolve, 5));

    await updateKbEntry(
      testPrisma,
      fixture.shopAId,
      fixture.entryAId,
      parseKbInput({
        title: "Đổi trả 7 ngày",
        answer: "Gửi lại hàng trong 7 ngày để được đổi hoặc hoàn tiền.",
      }),
    );

    // Index đã bị xoá ⇒ retrieve dựng lại từ DB và thấy tiêu đề mới ngay.
    const after = await retrieve(testPrisma, fixture.shopAId, "đổi trả 7 ngày", {
      embedder: fake.embedder,
    });
    expect(after.meta.builtAt).not.toBe(before.meta.builtAt);
    expect(after.meta.kbCount).toBe(1);
    expect(after.entries.map((entry) => entry.id)).toEqual([
      fixture.entryAId,
    ]);
    expect(after.entries.map((entry) => entry.title)).toContain(
      "Đổi trả 7 ngày",
    );
    expect(after.entries.map((entry) => entry.title)).not.toContain(
      "Chính sách đổi trả",
    );
    expect(
      fake.calls.some((call) =>
        call.texts.includes(
          "Đổi trả 7 ngày\nGửi lại hàng trong 7 ngày để được đổi hoặc hoàn tiền.",
        ),
      ),
    ).toBe(true);
  });

  it("create entry mới → retrieve thấy ngay; delete → không còn trong index", async () => {
    const fixture = await seedFixture();
    const fake = createFakeEmbedder();

    const created = await createKbEntry(
      testPrisma,
      fixture.shopAId,
      parseKbInput({
        title: "Phí ship",
        answer: "Miễn phí ship cho đơn từ 500k.",
      }),
    );

    const withNew = await retrieve(testPrisma, fixture.shopAId, "phí ship", {
      embedder: fake.embedder,
    });
    expect(withNew.meta.kbCount).toBe(2);
    expect(withNew.entries.map((entry) => entry.id)).toContain(created.id);
    expect(withNew.entries.map((entry) => entry.title)).toContain("Phí ship");

    await deleteKbEntry(testPrisma, fixture.shopAId, created.id);

    const afterDelete = await retrieve(
      testPrisma,
      fixture.shopAId,
      "phí ship",
      { embedder: fake.embedder },
    );
    expect(afterDelete.meta.kbCount).toBe(1);
    expect(afterDelete.entries.map((entry) => entry.id)).not.toContain(
      created.id,
    );
    expect(afterDelete.entries.map((entry) => entry.title)).not.toContain(
      "Phí ship",
    );
  });
});
