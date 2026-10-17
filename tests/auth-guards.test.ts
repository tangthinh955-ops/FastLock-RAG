import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requireUserWithToken } from "../lib/auth/guards";
import { ApiError } from "../lib/auth/service";
import { signToken, type TokenPayload } from "../lib/auth/token";

/**
 * Unit test cho phần logic thuần của guard — KHÔNG mock `next/headers`.
 *
 * `requireUser` (wrapper đọc cookie) chỉ là 1 dòng gọi `requireUserWithToken`
 * nên mọi nhánh quyết định (401/403/payload) đều nằm ở hàm thuần này và được
 * test trực tiếp bằng token thật ký qua `signToken`.
 */
const TEST_SECRET = "jwt-test-secret-cho-auth-guards";

const BUYER: TokenPayload = {
  userId: "22222222-2222-4222-8222-222222222222",
  role: "BUYER",
  name: "Khách",
};

const SELLER: TokenPayload = {
  userId: "33333333-3333-4333-8333-333333333333",
  role: "SELLER",
  name: "Linh",
};

describe("auth guards — requireUserWithToken (logic thuần, không mock next/headers)", () => {
  beforeEach(() => {
    vi.stubEnv("JWT_SECRET", TEST_SECRET);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  async function expectApiError(
    promise: Promise<unknown>,
    status: number,
  ): Promise<void> {
    const error = await promise.catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(status);
  }

  it("thiếu token (chưa đăng nhập) → ApiError 401", async () => {
    await expectApiError(requireUserWithToken(undefined), 401);
  });

  it("token không hợp lệ hoặc ký bằng secret khác → ApiError 401", async () => {
    await expectApiError(requireUserWithToken("khong-phai-jwt"), 401);

    // Token thật nhưng ký bằng secret khác → verify thất bại.
    vi.stubEnv("JWT_SECRET", "secret-hoan-toan-khac");
    const alienToken = await signToken(BUYER);
    vi.stubEnv("JWT_SECRET", TEST_SECRET);

    await expectApiError(requireUserWithToken(alienToken), 401);
  });

  it("role lệch (BUYER đòi quyền SELLER) → ApiError 403", async () => {
    const buyerToken = await signToken(BUYER);

    await expectApiError(requireUserWithToken(buyerToken, "SELLER"), 403);
  });

  it("token hợp lệ → trả đúng payload, kể cả khi role khớp hoặc không yêu cầu role", async () => {
    const buyerToken = await signToken(BUYER);
    expect(await requireUserWithToken(buyerToken)).toEqual(BUYER);
    expect(await requireUserWithToken(buyerToken, "BUYER")).toEqual(BUYER);

    const sellerToken = await signToken(SELLER);
    expect(await requireUserWithToken(sellerToken, "SELLER")).toEqual(SELLER);
  });
});
