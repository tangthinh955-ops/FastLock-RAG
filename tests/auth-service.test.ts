import { compare } from "bcryptjs";
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { ApiError, demoLogin, login, registerUser } from "../lib/auth/service";
import { seedBase } from "../prisma/seed/base";
import { SEED_IDS } from "../prisma/seed/ids";
import { resetDb, testPrisma } from "./helpers/db";

/**
 * Integration thật trên PostgreSQL test (không mock DB): service là hàm thuần
 * nhận prisma nên test truyền `testPrisma` — đúng cùng đường code với route
 * handlers (chúng truyền app singleton từ lib/db), khác mỗi connection string.
 */
describe("auth service — đăng ký / đăng nhập / demo-login", () => {
  beforeEach(async () => {
    await resetDb();
    // Mặc định bật DEMO_MODE cho các test demo-login; test nào cần tắt sẽ stub đè.
    vi.stubEnv("DEMO_MODE", "true");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  /** Assert promise ném ra ApiError đúng status — tránh lặp try/catch trong test. */
  async function expectApiError(
    promise: Promise<unknown>,
    status: number,
  ): Promise<void> {
    const error = await promise.catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(status);
  }

  it("đăng ký mới: payload BUYER, hash bcrypt 10 vòng ≠ plaintext, đăng nhập lại được", async () => {
    const payload = await registerUser(testPrisma, {
      email: "nguoimoi@demo.vn",
      password: "matkhau123",
      name: "Người Mới",
    });

    expect(payload.role).toBe("BUYER");
    expect(payload.name).toBe("Người Mới");
    expect(payload.userId).toBeTruthy();

    const user = await testPrisma.user.findUniqueOrThrow({
      where: { email: "nguoimoi@demo.vn" },
    });
    expect(user.id).toBe(payload.userId);
    expect(user.role).toBe("BUYER");
    // Không lưu plaintext: hash bcrypt đúng 10 vòng theo hợp đồng Task 6.
    expect(user.passwordHash).not.toBe("matkhau123");
    expect(user.passwordHash).toMatch(/^\$2[aby]\$10\$/);
    expect(await compare("matkhau123", user.passwordHash)).toBe(true);

    // Đăng nhập lại bằng chính tài khoản vừa tạo → cùng danh tính.
    const loggedIn = await login(testPrisma, {
      email: "nguoimoi@demo.vn",
      password: "matkhau123",
    });
    expect(loggedIn).toEqual({
      userId: user.id,
      role: "BUYER",
      name: "Người Mới",
    });
  });

  it("đăng ký trùng email → ApiError 409 (khác hoa/thường vẫn tính trùng)", async () => {
    await registerUser(testPrisma, {
      email: "trung@demo.vn",
      password: "matkhau123",
      name: "Người A",
    });

    await expectApiError(
      registerUser(testPrisma, {
        email: "TRUNG@demo.vn",
        password: "matkhau456",
        name: "Người B",
      }),
      409,
    );

    expect(
      await testPrisma.user.count({ where: { email: "trung@demo.vn" } }),
    ).toBe(1);
  });

  it("login sai mật khẩu hoặc email không tồn tại → ApiError 401", async () => {
    await registerUser(testPrisma, {
      email: "co@demo.vn",
      password: "matkhau123",
      name: "Cô",
    });

    await expectApiError(
      login(testPrisma, { email: "co@demo.vn", password: "sai-mat-khau" }),
      401,
    );
    await expectApiError(
      login(testPrisma, {
        email: "khong-ton-tai@demo.vn",
        password: "matkhau123",
      }),
      401,
    );
  });

  it("demoLogin('seller1') trả đúng user seed linh@demo.vn role SELLER", async () => {
    await seedBase(testPrisma);

    expect(await demoLogin(testPrisma, "seller1")).toEqual({
      userId: SEED_IDS.users.linh,
      role: "SELLER",
      name: "Linh",
    });

    // Đủ 3 đích của đăng nhập nhanh: buyer → khách, seller2 → Bảo An.
    expect(await demoLogin(testPrisma, "buyer")).toEqual({
      userId: SEED_IDS.users.khach,
      role: "BUYER",
      name: "Khách",
    });
    expect(await demoLogin(testPrisma, "seller2")).toEqual({
      userId: SEED_IDS.users.baoan,
      role: "SELLER",
      name: "Bảo An",
    });
  });

  it.each(["false", "1", "TRUE"])(
    "DEMO_MODE=%s (khác chuỗi 'true') → ApiError 404",
    async (mode) => {
      await seedBase(testPrisma);
      vi.stubEnv("DEMO_MODE", mode);

      await expectApiError(demoLogin(testPrisma, "buyer"), 404);
    },
  );
});
