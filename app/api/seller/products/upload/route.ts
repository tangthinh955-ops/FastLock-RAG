import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { unstable_rethrow } from "next/navigation";
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/guards";
import { ApiError } from "@/lib/auth/service";
import { prisma } from "@/lib/db";
import { requireSellerShop } from "@/lib/live/sessions";

/**
 * POST /api/seller/products/upload — nhận MỘT ảnh sản phẩm (Plan 3 Task 3).
 *
 * `multipart/form-data` với trường `file`. Chỉ jpg/png/webp ≤ 2 MB; tên file do
 * server sinh bằng `randomUUID()` + phần mở rộng suy từ MIME — KHÔNG dùng
 * `file.name` của client (chặn path traversal/đè file). Ảnh ghi vào
 * `public/uploads/` và trả `{ url: "/uploads/<name>" }` để lưu vào `imageUrl`.
 *
 * Cùng guard quyền với CRUD: `requireUser("SELLER")` + `requireSellerShop`.
 */

const MAX_BYTES = 2 * 1024 * 1024;
const UPLOADS_PUBLIC_PREFIX = "/uploads/";

/** MIME được nhận → phần mở rộng cố định (không lấy từ tên gốc). */
const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
};

const UPLOADS_DIR = path.join(process.cwd(), "public", "uploads");

export async function POST(request: Request) {
  try {
    const user = await requireUser("SELLER");
    await requireSellerShop(prisma, user.userId);

    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      throw new ApiError(400, "Dữ liệu gửi lên không hợp lệ");
    }

    const file = formData.get("file");
    if (!(file instanceof File)) {
      throw new ApiError(400, "Vui lòng chọn ảnh để tải lên");
    }

    const ext = EXT_BY_MIME[file.type.toLowerCase()];
    if (ext === undefined) {
      throw new ApiError(400, "Chỉ nhận ảnh JPG, PNG hoặc WEBP");
    }
    if (file.size === 0) {
      throw new ApiError(400, "File ảnh rỗng");
    }
    if (file.size > MAX_BYTES) {
      throw new ApiError(400, "Ảnh tối đa 2 MB");
    }

    await mkdir(UPLOADS_DIR, { recursive: true });
    const name = `${randomUUID()}${ext}`;
    const bytes = Buffer.from(await file.arrayBuffer());
    await writeFile(path.join(UPLOADS_DIR, name), bytes);

    return NextResponse.json({ url: `${UPLOADS_PUBLIC_PREFIX}${name}` });
  } catch (error) {
    // `cookies()` trong `requireUser` là Request-time API — lỗi bail-out lúc
    // prerender của Next phải để Next xử lý, không được nuốt vào nhánh 500.
    unstable_rethrow(error);
    if (error instanceof ApiError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    }
    console.error("POST /api/seller/products/upload lỗi:", error);
    return NextResponse.json(
      { error: "Lỗi hệ thống, vui lòng thử lại" },
      { status: 500 },
    );
  }
}
