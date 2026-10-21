import type { KbEntry, PrismaClient } from "../../generated/prisma/client";
import { ApiError } from "../auth/service";
import { invalidateShopIndex } from "../rag/index";

/**
 * CRUD mục kiến thức (KB) phía seller (Plan 3 Task 4 — spec §5.8 `/seller/kb`).
 *
 * Cùng pattern `ProductsPrisma`: hàm nhận `prisma` (app singleton hoặc
 * `testPrisma`), tự validate và ném `ApiError` tiếng Việt; route handler chỉ là
 * lớp mỏng. Danh tính shop do caller lấy từ `requireSellerShop` — KHÔNG bao giờ
 * nhận `shopId` từ client.
 *
 * Bất biến:
 * - `KbEntry` không có unique constraint (nhiều mục cùng chủ đề được), nên
 *   create không cần xử lý P2002.
 * - Mọi thao tác theo id đều lọc thêm `shopId`; id của shop khác và id không
 *   tồn tại trả CÙNG một 404 để không lộ nội dung của shop khác.
 * - Xoá luôn được — không có bảng nào tham chiếu `KbEntry`.
 * - Sau mỗi mutation thành công gọi `invalidateShopIndex(shopId)`: title +
 *   answer là toàn bộ text vector của entry, nên câu hỏi kế tiếp phải thấy nội
 *   dung mới ngay (spec §4/§12).
 */

/** Cùng pattern `OrdersPrisma`: instance app singleton hoặc testPrisma. */
export type KbPrisma = PrismaClient;

export type KbInput = {
  /** trim 1..120. */
  title: string;
  /** trim 1..4000. */
  answer: string;
};

const TITLE_MAX_LENGTH = 120;
const ANSWER_MAX_LENGTH = 4000;

const ERROR_INVALID_PAYLOAD = "Dữ liệu mục kiến thức không hợp lệ";
const ERROR_INVALID_TITLE = "Tiêu đề phải từ 1 đến 120 ký tự";
const ERROR_INVALID_ANSWER = "Nội dung trả lời phải từ 1 đến 4000 ký tự";

/** Cùng một câu cho mọi trường hợp id lạ hoặc thuộc shop khác. */
const ERROR_KB_NOT_FOUND = "Không tìm thấy mục kiến thức của shop bạn";

function readText(
  value: unknown,
  maxLength: number,
  message: string,
): string {
  if (typeof value !== "string") {
    throw new ApiError(400, message);
  }
  const text = value.trim();
  if (text.length === 0 || text.length > maxLength) {
    throw new ApiError(400, message);
  }
  return text;
}

/**
 * Chuẩn hoá + validate payload JSON. Ném `ApiError(400, tiếng Việt)` khi sai;
 * trả input sạch để service ghi thẳng xuống DB.
 */
export function parseKbInput(value: unknown): KbInput {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ApiError(400, ERROR_INVALID_PAYLOAD);
  }
  const raw = value as Record<string, unknown>;

  return {
    title: readText(raw.title, TITLE_MAX_LENGTH, ERROR_INVALID_TITLE),
    answer: readText(raw.answer, ANSWER_MAX_LENGTH, ERROR_INVALID_ANSWER),
  };
}

/** Mục kiến thức của đúng shop, mới sửa gần nhất lên đầu. */
export async function listShopKb(
  prisma: KbPrisma,
  shopId: string,
): Promise<KbEntry[]> {
  return prisma.kbEntry.findMany({
    where: { shopId },
    orderBy: { updatedAt: "desc" },
  });
}

/** Tạo mục kiến thức cho shop rồi xoá index RAG của shop đó. */
export async function createKbEntry(
  prisma: KbPrisma,
  shopId: string,
  input: KbInput,
): Promise<KbEntry> {
  const entry = await prisma.kbEntry.create({
    data: {
      shopId,
      title: input.title,
      answer: input.answer,
    },
  });

  invalidateShopIndex(shopId);
  return entry;
}

/**
 * Sửa mục kiến thức của shop. `findFirst({ id, shopId })` trước để trả 404
 * (không lộ nội dung shop khác), sau đó update theo id đã xác nhận thuộc shop.
 */
export async function updateKbEntry(
  prisma: KbPrisma,
  shopId: string,
  id: string,
  input: KbInput,
): Promise<KbEntry> {
  const existing = await prisma.kbEntry.findFirst({
    where: { id, shopId },
    select: { id: true },
  });
  if (existing === null) {
    throw new ApiError(404, ERROR_KB_NOT_FOUND);
  }

  const entry = await prisma.kbEntry.update({
    where: { id: existing.id },
    data: {
      title: input.title,
      answer: input.answer,
    },
  });

  invalidateShopIndex(shopId);
  return entry;
}

/**
 * Xoá mục kiến thức của shop. Luôn được phép — không có bảng nào tham chiếu
 * `KbEntry` (spec §5.8); chỉ id không thuộc shop mới 404.
 */
export async function deleteKbEntry(
  prisma: KbPrisma,
  shopId: string,
  id: string,
): Promise<void> {
  const existing = await prisma.kbEntry.findFirst({
    where: { id, shopId },
    select: { id: true },
  });
  if (existing === null) {
    throw new ApiError(404, ERROR_KB_NOT_FOUND);
  }

  await prisma.kbEntry.delete({ where: { id: existing.id } });

  invalidateShopIndex(shopId);
}
