import { Prisma } from "../../generated/prisma/client";
import type { PrismaClient, Product } from "../../generated/prisma/client";
import { ApiError } from "../auth/service";
import { invalidateShopIndex } from "../rag/index";

/**
 * CRUD sản phẩm phía seller (Plan 3 Task 3 — spec §5.8 `/seller/products`).
 *
 * Cùng pattern `OrdersPrisma`: hàm nhận `prisma` (app singleton hoặc
 * `testPrisma`), tự validate và ném `ApiError` tiếng Việt; route handler chỉ là
 * lớp mỏng. Danh tính shop do caller lấy từ `requireSellerShop` — KHÔNG bao giờ
 * nhận `shopId` từ client.
 *
 * Bất biến:
 * - SKU unique trong phạm vi MỘT shop (`@@unique([shopId, sku])`): trùng → 409,
 *   nhưng hai shop khác nhau được dùng cùng mã.
 * - Mọi thao tác theo id đều lọc thêm `shopId`; id của shop khác và id không
 *   tồn tại trả CÙNG một 404 để không lộ sản phẩm của shop khác.
 * - Sau mỗi mutation thành công gọi `invalidateShopIndex(shopId)` — tên/SKU là
 *   một phần text vector nên AI phải thấy dữ liệu mới ngay ở câu hỏi kế tiếp
 *   (giá/kho không nằm trong vector, xem `lib/rag/index.ts`).
 */

/** Cùng pattern `OrdersPrisma`: instance app singleton hoặc testPrisma. */
export type ProductsPrisma = PrismaClient;

export type ProductInput = {
  /** trim + upper; 2–20 ký tự chữ/số/gạch dưới/gạch ngang. */
  sku: string;
  /** trim 1..120. */
  name: string;
  /** Số nguyên VND 0..100.000.000. */
  price: number;
  /** Số nguyên 0..100.000. */
  stock: number;
  /** null hoặc đường dẫn nội bộ bắt đầu bằng "/uploads/". */
  imageUrl: string | null;
};

const SKU_PATTERN = /^[A-Z0-9][A-Z0-9_-]{1,19}$/;
const NAME_MAX_LENGTH = 120;
const PRICE_MAX = 100_000_000;
const STOCK_MAX = 100_000;
const UPLOADS_PREFIX = "/uploads/";

const ERROR_INVALID_PAYLOAD = "Dữ liệu sản phẩm không hợp lệ";
const ERROR_INVALID_SKU =
  "SKU phải có 2–20 ký tự, chỉ gồm chữ, số, gạch dưới hoặc gạch ngang";
const ERROR_INVALID_NAME = "Tên sản phẩm phải từ 1 đến 120 ký tự";
const ERROR_INVALID_PRICE = "Giá phải là số nguyên từ 0 đến 100.000.000";
const ERROR_INVALID_STOCK = "Kho phải là số nguyên từ 0 đến 100.000";
const ERROR_INVALID_IMAGE = "Ảnh phải là đường dẫn trong /uploads/";

/** Cùng một câu cho mọi trường hợp id lạ hoặc thuộc shop khác. */
const ERROR_PRODUCT_NOT_FOUND = "Không tìm thấy sản phẩm của shop bạn";
const ERROR_DUPLICATE_SKU = "SKU đã có trong shop này";
const ERROR_HAS_ORDERS = "Sản phẩm đã có đơn — không xoá được";

/** Lỗi Prisma đã biết đúng mã — Prisma 7 + adapter không kèm `meta.target` ổn định. */
function isPrismaError(error: unknown, code: string): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === code
  );
}

function readSku(value: unknown): string {
  if (typeof value !== "string") {
    throw new ApiError(400, ERROR_INVALID_SKU);
  }
  const sku = value.trim().toUpperCase();
  if (!SKU_PATTERN.test(sku)) {
    throw new ApiError(400, ERROR_INVALID_SKU);
  }
  return sku;
}

function readName(value: unknown): string {
  if (typeof value !== "string") {
    throw new ApiError(400, ERROR_INVALID_NAME);
  }
  const name = value.trim();
  if (name.length === 0 || name.length > NAME_MAX_LENGTH) {
    throw new ApiError(400, ERROR_INVALID_NAME);
  }
  return name;
}

function readIntInRange(
  value: unknown,
  max: number,
  message: string,
): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 0 ||
    value > max
  ) {
    throw new ApiError(400, message);
  }
  return value;
}

function readImageUrl(value: unknown): string | null {
  // Thiếu trường cũng coi như "không có ảnh" — form mới luôn gửi null.
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== "string") {
    throw new ApiError(400, ERROR_INVALID_IMAGE);
  }
  const imageUrl = value.trim();
  // Chỉ nhận file do route upload của mình trả về. Chặn cả "javascript:",
  // URL ngoài và path traversal (`..`, backslash) dù đã bắt đầu bằng /uploads/.
  if (
    !imageUrl.startsWith(UPLOADS_PREFIX) ||
    imageUrl.includes("..") ||
    imageUrl.includes("\\")
  ) {
    throw new ApiError(400, ERROR_INVALID_IMAGE);
  }
  return imageUrl;
}

/**
 * Chuẩn hoá + validate payload JSON. Ném `ApiError(400, tiếng Việt)` khi sai;
 * trả input sạch để service ghi thẳng xuống DB.
 */
export function parseProductInput(value: unknown): ProductInput {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ApiError(400, ERROR_INVALID_PAYLOAD);
  }
  const raw = value as Record<string, unknown>;

  return {
    sku: readSku(raw.sku),
    name: readName(raw.name),
    price: readIntInRange(raw.price, PRICE_MAX, ERROR_INVALID_PRICE),
    stock: readIntInRange(raw.stock, STOCK_MAX, ERROR_INVALID_STOCK),
    imageUrl: readImageUrl(raw.imageUrl),
  };
}

/** Sản phẩm của đúng shop, SKU tăng dần (bảng dễ tra). */
export async function listShopProducts(
  prisma: ProductsPrisma,
  shopId: string,
): Promise<Product[]> {
  return prisma.product.findMany({
    where: { shopId },
    orderBy: { sku: "asc" },
  });
}

/**
 * Tạo sản phẩm. P2002 chỉ được nuốt khi đọc lại ĐÚNG cặp `[shopId, sku]` thấy
 * dòng đã tồn tại — P2002 của ràng buộc khác phải ném tiếp, không giả làm 409.
 */
export async function createProduct(
  prisma: ProductsPrisma,
  shopId: string,
  input: ProductInput,
): Promise<Product> {
  let product: Product;
  try {
    product = await prisma.product.create({
      data: {
        shopId,
        sku: input.sku,
        name: input.name,
        price: input.price,
        stock: input.stock,
        imageUrl: input.imageUrl,
      },
    });
  } catch (error) {
    if (isPrismaError(error, "P2002")) {
      const duplicate = await prisma.product.findUnique({
        where: { shopId_sku: { shopId, sku: input.sku } },
        select: { id: true },
      });
      if (duplicate !== null) {
        throw new ApiError(409, ERROR_DUPLICATE_SKU);
      }
    }
    throw error;
  }

  invalidateShopIndex(shopId);
  return product;
}

/**
 * Sửa sản phẩm của shop. `findFirst({ id, shopId })` trước để trả 404 (không lộ
 * sản phẩm shop khác), sau đó update theo id đã xác nhận thuộc shop.
 */
export async function updateProduct(
  prisma: ProductsPrisma,
  shopId: string,
  productId: string,
  input: ProductInput,
): Promise<Product> {
  const existing = await prisma.product.findFirst({
    where: { id: productId, shopId },
    select: { id: true },
  });
  if (existing === null) {
    throw new ApiError(404, ERROR_PRODUCT_NOT_FOUND);
  }

  let product: Product;
  try {
    product = await prisma.product.update({
      where: { id: existing.id },
      data: {
        sku: input.sku,
        name: input.name,
        price: input.price,
        stock: input.stock,
        imageUrl: input.imageUrl,
      },
    });
  } catch (error) {
    if (isPrismaError(error, "P2002")) {
      const duplicate = await prisma.product.findUnique({
        where: { shopId_sku: { shopId, sku: input.sku } },
        select: { id: true },
      });
      if (duplicate !== null && duplicate.id !== existing.id) {
        throw new ApiError(409, ERROR_DUPLICATE_SKU);
      }
    }
    throw error;
  }

  invalidateShopIndex(shopId);
  return product;
}

/**
 * Xoá sản phẩm của shop. Đã có Order tham chiếu thì 409 — kiểm tra trước để báo
 * lỗi nghiệp vụ, vẫn bắt P2003 ở lần xoá (đơn vừa tạo giữa count và delete) và
 * quy về CÙNG thông điệp.
 */
export async function deleteProduct(
  prisma: ProductsPrisma,
  shopId: string,
  productId: string,
): Promise<void> {
  const existing = await prisma.product.findFirst({
    where: { id: productId, shopId },
    select: { id: true },
  });
  if (existing === null) {
    throw new ApiError(404, ERROR_PRODUCT_NOT_FOUND);
  }

  const orderCount = await prisma.order.count({
    where: { productId: existing.id },
  });
  if (orderCount > 0) {
    throw new ApiError(409, ERROR_HAS_ORDERS);
  }

  try {
    await prisma.product.delete({ where: { id: existing.id } });
  } catch (error) {
    if (isPrismaError(error, "P2003")) {
      throw new ApiError(409, ERROR_HAS_ORDERS);
    }
    throw error;
  }

  invalidateShopIndex(shopId);
}
