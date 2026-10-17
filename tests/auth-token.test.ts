import { jwtVerify, SignJWT } from "jose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COOKIE_NAME } from "../lib/auth/constants";
import { signToken, verifyToken, type TokenPayload } from "../lib/auth/token";

const TEST_SECRET = "jwt-test-secret-dung-cho-unit-test";
const PAYLOAD: TokenPayload = {
  userId: "11111111-1111-4111-8111-111111111111",
  role: "BUYER",
  name: "Khách",
};

/**
 * Token hết hạn 1 giây trước. `signToken` luôn gắn hạn 7 ngày nên không thể
 * tạo token quá hạn qua nó — helper này ký bằng jose với `exp` trong quá khứ.
 */
async function signExpiredToken(secretText: string): Promise<string> {
  const nowSeconds = Math.floor(Date.now() / 1000);
  return new SignJWT({ ...PAYLOAD })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt(nowSeconds - 60)
    .setExpirationTime(nowSeconds - 1)
    .sign(new TextEncoder().encode(secretText));
}

describe("auth token — ký/verify JWT (jose HS256)", () => {
  beforeEach(() => {
    vi.stubEnv("JWT_SECRET", TEST_SECRET);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("COOKIE_NAME đúng tên cookie dùng chung HTTP + socket", () => {
    expect(COOKIE_NAME).toBe("liveorder_token");
  });

  it("roundtrip: sign → verify trả đúng payload, hạn 7 ngày", async () => {
    const token = await signToken(PAYLOAD);

    expect(await verifyToken(token)).toEqual(PAYLOAD);

    // Phiên đăng nhập sống 7 ngày kể từ lúc ký (spec §4).
    const { payload: claims } = await jwtVerify(
      token,
      new TextEncoder().encode(TEST_SECRET),
    );
    expect((claims.exp ?? 0) - (claims.iat ?? 0)).toBe(7 * 24 * 60 * 60);
  });

  it("token bị sửa 1 ký tự → null", async () => {
    const token = await signToken(PAYLOAD);
    const [header, body, signature] = token.split(".");

    // Đổi ký tự đầu của phần chữ ký — token vẫn đúng định dạng JWT nhưng sai chữ ký.
    const flippedChar = signature[0] === "A" ? "B" : "A";
    const tampered = `${header}.${body}.${flippedChar}${signature.slice(1)}`;

    expect(tampered).not.toBe(token);
    expect(tampered.length).toBe(token.length);
    expect(await verifyToken(tampered)).toBeNull();
  });

  it("token hết hạn (exp -1s) → null", async () => {
    const expired = await signExpiredToken(TEST_SECRET);

    expect(await verifyToken(expired)).toBeNull();
  });

  it("chuỗi không phải JWT → null, không throw", async () => {
    expect(await verifyToken("khong-phai-jwt")).toBeNull();
  });

  it("JWT_SECRET chỉ đọc lúc gọi: đổi secret thì token cũ không verify được", async () => {
    const token = await signToken(PAYLOAD);
    vi.stubEnv("JWT_SECRET", "secret-khac-hoan-toan");

    expect(await verifyToken(token)).toBeNull();
  });
});
