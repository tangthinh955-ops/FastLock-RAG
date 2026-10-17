import { SignJWT, jwtVerify } from "jose";

/**
 * Danh tính tối thiểu gắn vào JWT — cũng là shape của `socket.data.user`
 * (Task 10) và kết quả `verifyToken` trả về cho mọi nơi cần xác thực.
 */
export type TokenPayload = {
  userId: string;
  role: "BUYER" | "SELLER";
  name: string;
};

/**
 * Đọc `JWT_SECRET` **lúc gọi**, không cache ở module scope: test và các
 * luồng đổi cấu hình phải có hiệu lực ngay ở lần gọi kế tiếp.
 */
function getSecretKey(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET is not set — copy .env.example to .env");
  }
  return new TextEncoder().encode(secret);
}

/** Ký JWT HS256 hạn 7 ngày — dùng cho cookie httpOnly lẫn socket handshake. */
export async function signToken(payload: TokenPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(getSecretKey());
}

/**
 * Verify JWT: trả payload khi chữ ký hợp lệ và còn hạn, ngược lại `null`.
 *
 * Mọi lỗi (sai chữ ký, token hỏng, hết hạn, thiếu `JWT_SECRET`) đều quy về
 * `null` để lớp gọi chỉ cần xử lý đúng một trạng thái "chưa xác thực".
 */
export async function verifyToken(token: string): Promise<TokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecretKey(), {
      algorithms: ["HS256"],
    });

    // Token ta ký luôn đủ 3 field; chặn cả token lạ đúng chữ ký nhưng thiếu/sai kiểu.
    if (
      typeof payload.userId !== "string" ||
      typeof payload.name !== "string" ||
      (payload.role !== "BUYER" && payload.role !== "SELLER")
    ) {
      return null;
    }

    return { userId: payload.userId, role: payload.role, name: payload.name };
  } catch {
    return null;
  }
}
