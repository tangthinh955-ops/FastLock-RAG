import { compare, hash } from "bcryptjs";
import {
  Prisma,
  PrismaClient,
} from "../../generated/prisma/client";
import type { TokenPayload } from "./token";

/**
 * Lỗi nghiệp vụ auth kèm mã HTTP.
 *
 * Route handlers bắt đúng class này để trả `{ error, status }`; mọi lỗi khác
 * được coi là 500. Nhờ vậy service (hàm thuần, test được) quyết định status
 * thay vì để route handler đoán theo chuỗi thông báo.
 */
export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

/**
 * Client Prisma dạng instance — caller truyền app singleton (`lib/db.ts`) hoặc
 * `testPrisma` (integration test). Service không tự tạo kết nối.
 */
export type AuthPrisma = InstanceType<typeof PrismaClient>;

/** Hợp đồng Task 6: bcrypt 10 vòng — cùng mức với hash seed của tài khoản demo. */
const BCRYPT_ROUNDS = 10;

/** Đủ chặt cho validate form demo: có ký tự trước/sau @ và một dấu chấm ở domain. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Chuẩn hoá email trước khi tra/lưu: bỏ khoảng trắng và đưa về chữ thường để
 * "Trung@Demo.vn" không tạo được tài khoản thứ hai cho cùng một người.
 */
function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

interface RegisterInput {
  email: string;
  password: string;
  name: string;
}

interface LoginInput {
  email: string;
  password: string;
}

/**
 * Đăng ký tài khoản mới → luôn là BUYER (seller chỉ có tài khoản seed).
 * Validate server-side vì API là public; validate lần hai ở client chỉ để UX.
 */
export async function registerUser(
  prisma: AuthPrisma,
  { email, password, name }: RegisterInput,
): Promise<TokenPayload> {
  const normalizedEmail = normalizeEmail(email);
  const trimmedName = name.trim();

  if (!EMAIL_RE.test(normalizedEmail)) {
    throw new ApiError(400, "Email không hợp lệ");
  }
  if (password.length < 6) {
    throw new ApiError(400, "Mật khẩu phải có ít nhất 6 ký tự");
  }
  if (!trimmedName) {
    throw new ApiError(400, "Vui lòng nhập tên");
  }

  const existing = await prisma.user.findUnique({
    where: { email: normalizedEmail },
  });
  if (existing) {
    throw new ApiError(409, "Email này đã được đăng ký");
  }

  const passwordHash = await hash(password, BCRYPT_ROUNDS);

  try {
    const user = await prisma.user.create({
      data: {
        email: normalizedEmail,
        passwordHash,
        name: trimmedName,
        role: "BUYER",
      },
    });

    return { userId: user.id, role: user.role, name: user.name };
  } catch (error) {
    // Hai request đăng ký cùng email chạy song song có thể lọt qua bước
    // findUnique — unique index ở DB bắn P2002, vẫn phải quy về 409.
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      throw new ApiError(409, "Email này đã được đăng ký");
    }
    throw error;
  }
}

/**
 * Đăng nhập bằng mật khẩu.
 * Cùng một thông báo cho "email không tồn tại" và "sai mật khẩu" để không lộ
 * email nào đã có tài khoản.
 */
export async function login(
  prisma: AuthPrisma,
  { email, password }: LoginInput,
): Promise<TokenPayload> {
  const user = await prisma.user.findUnique({
    where: { email: normalizeEmail(email) },
  });

  if (!user || !(await compare(password, user.passwordHash))) {
    throw new ApiError(401, "Email hoặc mật khẩu không đúng");
  }

  return { userId: user.id, role: user.role, name: user.name };
}

/** Ba đích của nút "đăng nhập nhanh" trên trang /login (spec §8.7). */
export type DemoLoginAs = "buyer" | "seller1" | "seller2";

/** Email cố định của tài khoản seed nền (Task 3) — tra thẳng, không tìm theo tên. */
const DEMO_LOGIN_EMAILS: Record<DemoLoginAs, string> = {
  buyer: "khach@demo.vn",
  seller1: "linh@demo.vn",
  seller2: "baoan@demo.vn",
};

/**
 * Đăng nhập nhanh tài khoản demo — chỉ sống khi `DEMO_MODE` đúng chuỗi 'true'
 * (so sánh nghiêm ngặt: "1", "TRUE"… đều không bật).
 */
export async function demoLogin(
  prisma: AuthPrisma,
  as: DemoLoginAs,
): Promise<TokenPayload> {
  if (process.env.DEMO_MODE !== "true") {
    throw new ApiError(404, "Đăng nhập nhanh chỉ có trong chế độ demo");
  }

  const user = await prisma.user.findUnique({
    where: { email: DEMO_LOGIN_EMAILS[as] },
  });
  if (!user) {
    throw new ApiError(404, "Không tìm thấy tài khoản demo — hãy chạy npm run seed");
  }

  return { userId: user.id, role: user.role, name: user.name };
}
