import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { Server } from "socket.io";
import type { ReminderDeps } from "../lib/chat/reminders";
import type { InboxMessageEvent } from "../lib/chat/flow";
import {
  cancelPaymentReminder,
  PAYMENT_REMIND_DELAY_MS,
  remindPendingOrdersForSession,
  schedulePaymentReminder,
} from "../lib/chat/reminders";
import {
  conversationRoom,
  INBOX_NAMESPACE,
  setInboxIo,
  shopInboxRoom,
} from "../lib/socket-registry";
import { resetDb, testPrisma } from "./helpers/db";

/**
 * Integration thật trên PostgreSQL test cho nhắc thanh toán "dây A" (Task 8):
 * timer 5 phút + hook end-live gửi ĐÚNG MỘT tin SYSTEM cho mỗi đơn còn PENDING,
 * dedup mức DB (`DirectMessage.dedupKey = order:{id}:remind`) là nguồn sự thật —
 * timer chạy lại / end-live chạy chồng đều không nhân tin (spec §7.6).
 *
 * Bất biến quan trọng:
 * - Trước khi gửi, ĐỌC LẠI đơn: `status !== PENDING` (đã PAID/… ) → im lặng.
 * - `prisma` luôn được tiêm `testPrisma`; emit là fake thu sự kiện (không socket).
 * - Vitest fake timers cho timer 5 phút; chờ I/O DB bằng đồng hồ THẬT qua
 *   `waitUntil` — không test nào dùng delay thật 5 phút.
 */

/** `setTimeout` THẬT chụp lúc nạp module (trước khi fake timers bật) — chỉ để chờ DB. */
const realSetTimeout = globalThis.setTimeout;

/** Chờ bằng đồng hồ thật; fake timers không chặn I/O thật của Postgres. */
function waitReal(ms: number): Promise<void> {
  return new Promise((resolve) => realSetTimeout(resolve, ms));
}

/** Poll điều kiện DB tối đa ~1s (đồng hồ thật) — hết hạn thì fail rõ ràng. */
async function waitUntil(
  label: string,
  check: () => Promise<boolean>,
): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (await check()) {
      return;
    }
    await waitReal(5);
  }
  throw new Error(`waitUntil hết hạn chờ: ${label}`);
}

type Fixture = {
  shopId: string;
  buyerId: string;
  productId: string;
  productName: string;
  price: number;
  sessionId: string;
};

/** Một shop + buyer + sản phẩm + phiên LIVE — tối thiểu cho kịch bản nhắc. */
async function seedReminderFixture(): Promise<Fixture> {
  const owner = await testPrisma.user.create({
    data: {
      email: "owner-remind@test.vn",
      passwordHash: "x",
      name: "Chủ shop Nhắc",
      role: "SELLER",
    },
  });
  const buyer = await testPrisma.user.create({
    data: {
      email: "buyer-remind@test.vn",
      passwordHash: "x",
      name: "Khách Nhắc",
      role: "BUYER",
    },
  });
  const shop = await testPrisma.shop.create({
    data: { name: "Shop Nhắc Thanh Toán", ownerId: owner.id },
  });
  const product = await testPrisma.product.create({
    data: {
      shopId: shop.id,
      sku: "RM01",
      name: "Áo thun basic",
      price: 120_000,
      stock: 10,
    },
  });
  const session = await testPrisma.liveSession.create({
    data: { shopId: shop.id, title: "Live nhắc thanh toán", status: "LIVE" },
  });

  return {
    shopId: shop.id,
    buyerId: buyer.id,
    productId: product.id,
    productName: product.name,
    price: product.price,
    sessionId: session.id,
  };
}

let orderSeq = 0;

/** Đơn tạo thẳng trong DB (không qua pipeline comment) — đủ field bắt buộc. */
function createOrder(
  fixture: Fixture,
  options: { qty?: number; status?: "PENDING" | "PAID" } = {},
) {
  orderSeq += 1;
  const qty = options.qty ?? 1;
  const status = options.status ?? "PENDING";
  return testPrisma.order.create({
    data: {
      shopId: fixture.shopId,
      buyerId: fixture.buyerId,
      productId: fixture.productId,
      qty,
      unitPrice: fixture.price,
      total: fixture.price * qty,
      status,
      paidAt: status === "PAID" ? new Date() : null,
      eventId: `test-reminders-${orderSeq}`,
      paymentCode: `TESTRM${orderSeq}`,
      liveSessionId: fixture.sessionId,
    },
  });
}

/** Tin SYSTEM đã nhắc của một đơn — khoá dedup là "1 tin/đơn" ở mức DB. */
function reminderRows(orderId: string) {
  return testPrisma.directMessage.findMany({
    where: { dedupKey: `order:${orderId}:remind` },
  });
}

type CapturedEmit = {
  event: InboxMessageEvent;
  conversationId: string;
  shopId: string;
};

/** Emit giả: thu sự kiện + phòng phát (không dựng socket trong test). */
function createEmitRecorder(): {
  events: CapturedEmit[];
  emit: NonNullable<ReminderDeps["emit"]>;
} {
  const events: CapturedEmit[] = [];
  return {
    events,
    emit: (event, conversationId, shopId) => {
      events.push({ event, conversationId, shopId });
    },
  };
}

describe("nhắc thanh toán — 1 tin/đơn, guard PAID, hook end-live (Task 8)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterEach(async () => {
    // Không để fake timers / timer 5' / env stub rò sang test sau (kể cả khi fail).
    vi.useRealTimers();
    vi.unstubAllEnvs();
    for (const orderId of [...(globalThis.__liveReminders?.keys() ?? [])]) {
      cancelPaymentReminder(orderId);
    }
  });

  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  it("(a) hẹn 100ms → đúng 1 tin SYSTEM + 1 emit; hẹn lại cùng đơn rồi fire → vẫn 1 tin", async () => {
    const fixture = await seedReminderFixture();
    const order = await createOrder(fixture, { qty: 2 });
    const { events, emit } = createEmitRecorder();

    vi.useFakeTimers();
    schedulePaymentReminder(order.id, fixture.buyerId, fixture.shopId, {
      prisma: testPrisma,
      delayMs: 100,
      emit,
    });

    // Timer nằm trong sổ global (R18) và CHƯA gửi gì trước khi fire.
    expect(globalThis.__liveReminders?.has(order.id)).toBe(true);
    expect(await testPrisma.directMessage.count()).toBe(0);

    await vi.advanceTimersByTimeAsync(100);
    await waitUntil("tin nhắc đầu tiên vào DB", async () => {
      return (await reminderRows(order.id)).length === 1;
    });

    // Fire xong: timer tự xoá khỏi sổ — không rò.
    expect(globalThis.__liveReminders?.has(order.id)).toBe(false);

    const rows = await reminderRows(order.id);
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.source).toBe("SYSTEM");
    expect(row.dedupKey).toBe(`order:${order.id}:remind`);
    expect(row.orderId).toBe(order.id);
    expect(row.content).toBe(
      `⏰ Đơn #${order.code} (Áo thun basic ×2 — 240.000đ) vẫn đang chờ thanh toán. ` +
        `Shop chỉ giữ hàng 15 phút kể từ lúc chốt nhé, bạn mở mục "Đơn của tôi" để thanh toán nha!`,
    );
    expect(row.content).not.toContain("Plan");

    // Đúng 1 hội thoại và 1 tin trong toàn DB — không rác thêm.
    expect(await testPrisma.conversation.count()).toBe(1);
    expect(await testPrisma.directMessage.count()).toBe(1);

    // Phát socket đúng một lần, đúng phòng (conversation + shop) và không lộ dedupKey.
    expect(events).toHaveLength(1);
    expect(events[0].conversationId).toBe(row.conversationId);
    expect(events[0].shopId).toBe(fixture.shopId);
    expect(events[0].event).toEqual({
      message: {
        id: row.id,
        conversationId: row.conversationId,
        source: "SYSTEM",
        content: row.content,
        orderId: order.id,
        trace: undefined,
        createdAt: row.createdAt.toISOString(),
      },
    });

    // Hẹn LẠI cùng đơn (kịch bản retry/hai nguồn cùng hẹn) rồi fire: dedup DB
    // chặn tin thứ hai — không ghi, không phát lại.
    schedulePaymentReminder(order.id, fixture.buyerId, fixture.shopId, {
      prisma: testPrisma,
      delayMs: 100,
      emit,
    });
    await vi.advanceTimersByTimeAsync(100);
    expect(globalThis.__liveReminders?.has(order.id)).toBe(false);
    await waitReal(150); // cửa sổ cho lần gửi thứ hai (nếu bug) rơi vào

    expect(await reminderRows(order.id)).toHaveLength(1);
    expect(await testPrisma.directMessage.count()).toBe(1);
    expect(events).toHaveLength(1);
  });

  it("(b) đơn đã PAID trước khi timer fire → không tin, không emit, không hội thoại", async () => {
    const fixture = await seedReminderFixture();
    const order = await createOrder(fixture);
    const { events, emit } = createEmitRecorder();

    vi.useFakeTimers();
    schedulePaymentReminder(order.id, fixture.buyerId, fixture.shopId, {
      prisma: testPrisma,
      delayMs: 100,
      emit,
    });

    // Khách trả tiền trong lúc chờ 5 phút — guard phải đọc LẠI và thấy PAID.
    await testPrisma.order.update({
      where: { id: order.id },
      data: { status: "PAID", paidAt: new Date() },
    });

    await vi.advanceTimersByTimeAsync(100);
    // Callback đã chạy (xoá sổ ngay khi nổ); chờ thêm cho nhánh gửi rơi vào.
    expect(globalThis.__liveReminders?.has(order.id)).toBe(false);
    await waitReal(150);

    expect(await reminderRows(order.id)).toHaveLength(0);
    expect(await testPrisma.directMessage.count()).toBe(0);
    expect(await testPrisma.conversation.count()).toBe(0);
    expect(events).toHaveLength(0);
  });

  it("(c) end-live: 2 PENDING + 1 PAID → nhắc 2 (DB đúng 2 tin SYSTEM); gọi lại → 0", async () => {
    const fixture = await seedReminderFixture();
    const pending1 = await createOrder(fixture, { qty: 1 });
    const pending2 = await createOrder(fixture, { qty: 3 });
    const paid = await createOrder(fixture, { status: "PAID" });
    const { events, emit } = createEmitRecorder();

    const reminded = await remindPendingOrdersForSession(fixture.sessionId, {
      prisma: testPrisma,
      emit,
    });
    expect(reminded).toBe(2);

    const rows = await testPrisma.directMessage.findMany({
      where: { source: "SYSTEM" },
    });
    expect(rows).toHaveLength(2);
    const byDedupKey = new Map(rows.map((row) => [row.dedupKey, row]));
    expect(new Set(byDedupKey.keys())).toEqual(
      new Set([`order:${pending1.id}:remind`, `order:${pending2.id}:remind`]),
    );
    expect(byDedupKey.has(`order:${paid.id}:remind`)).toBe(false);

    // Cùng một hội thoại buyer ↔ shop cho cả hai tin của cùng người mua.
    const conversation = await testPrisma.conversation.findFirstOrThrow();
    expect(rows.every((row) => row.conversationId === conversation.id)).toBe(
      true,
    );
    expect(byDedupKey.get(`order:${pending1.id}:remind`)?.content).toContain(
      "Áo thun basic ×1",
    );
    expect(byDedupKey.get(`order:${pending2.id}:remind`)?.content).toContain(
      "Áo thun basic ×3 — 360.000đ",
    );

    // Phát socket: 2 sự kiện, cùng phòng hội thoại + phòng shop.
    expect(events).toHaveLength(2);
    expect(events.map((entry) => entry.conversationId)).toEqual([
      conversation.id,
      conversation.id,
    ]);
    expect(events.map((entry) => entry.shopId)).toEqual([
      fixture.shopId,
      fixture.shopId,
    ]);

    // Gọi lần hai (end-live chạy chồng / double-fire): đơn vẫn PENDING nhưng
    // dedup chặn — trả 0, DB vẫn 2 tin, không phát lại socket.
    const second = await remindPendingOrdersForSession(fixture.sessionId, {
      prisma: testPrisma,
      emit,
    });
    expect(second).toBe(0);
    expect(await testPrisma.directMessage.count({ where: { source: "SYSTEM" } })).toBe(2);
    expect(events).toHaveLength(2);
  });

  it("(d) R-P4: không truyền delayMs → đọc env lúc gọi; mặc định là hằng số 5 phút", async () => {
    expect(PAYMENT_REMIND_DELAY_MS).toBe(5 * 60_000);

    const fixture = await seedReminderFixture();
    const order = await createOrder(fixture);
    const { events, emit } = createEmitRecorder();

    vi.stubEnv("PAYMENT_REMIND_DELAY_MS", "100");
    vi.useFakeTimers();
    schedulePaymentReminder(order.id, fixture.buyerId, fixture.shopId, {
      prisma: testPrisma,
      emit,
    });

    // Chưa đủ 100ms (env đọc lúc gọi) → chưa gửi.
    await vi.advanceTimersByTimeAsync(99);
    expect(await reminderRows(order.id)).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(1);
    await waitUntil("tin nhắc theo env delay", async () => {
      return (await reminderRows(order.id)).length === 1;
    });
    expect(events).toHaveLength(1);
  });

  it("(e) đơn không còn tồn tại khi fire → im lặng, không tạo hội thoại/tin", async () => {
    const fixture = await seedReminderFixture();
    const { events, emit } = createEmitRecorder();
    const ghostOrderId = "00000000-0000-4000-8000-000000000000";

    vi.useFakeTimers();
    schedulePaymentReminder(ghostOrderId, fixture.buyerId, fixture.shopId, {
      prisma: testPrisma,
      delayMs: 100,
      emit,
    });
    await vi.advanceTimersByTimeAsync(100);
    await waitReal(150);

    expect(globalThis.__liveReminders?.has(ghostOrderId)).toBe(false);
    expect(await testPrisma.directMessage.count()).toBe(0);
    expect(await testPrisma.conversation.count()).toBe(0);
    expect(events).toHaveLength(0);
  });

  it("(f) mặc định KHÔNG truyền emit → phát qua registry: /inbox, phòng hội thoại + shop", async () => {
    const fixture = await seedReminderFixture();
    const order = await createOrder(fixture);

    type EmittedCall = {
      namespace: string;
      rooms: string[];
      event: string;
      payload: unknown;
    };
    const calls: EmittedCall[] = [];
    const fakeIo = {
      of(namespace: string) {
        const rooms: string[] = [];
        const nsp = {
          to(room: string) {
            rooms.push(room);
            return nsp;
          },
          emit(event: string, payload: unknown) {
            calls.push({ namespace, rooms: [...rooms], event, payload });
            return true;
          },
        };
        return nsp;
      },
    } as unknown as Server;

    setInboxIo(fakeIo);
    try {
      const reminded = await remindPendingOrdersForSession(fixture.sessionId, {
        prisma: testPrisma,
      });
      expect(reminded).toBe(1);
    } finally {
      globalThis.__inboxIo = undefined;
    }

    const row = (await reminderRows(order.id))[0];
    expect(calls).toHaveLength(1);
    expect(calls[0].namespace).toBe(INBOX_NAMESPACE);
    expect(calls[0].rooms).toEqual([
      conversationRoom(row.conversationId),
      shopInboxRoom(fixture.shopId),
    ]);
    expect(calls[0].event).toBe("message");
    expect(calls[0].payload).toEqual({
      message: {
        id: row.id,
        conversationId: row.conversationId,
        source: "SYSTEM",
        content: row.content,
        orderId: order.id,
        trace: undefined,
        createdAt: row.createdAt.toISOString(),
      },
    });

    // Không có io (CLI/test): vẫn ghi DB, KHÔNG ném — cũng là chốt chặn "emit
    // không được làm chết timer" trên đường mặc định.
    await createOrder(fixture);
    expect(
      await remindPendingOrdersForSession(fixture.sessionId, {
        prisma: testPrisma,
      }),
    ).toBe(1);
    expect(calls).toHaveLength(1);
  });

  it("(g) emit ném lỗi → chỉ log, không ném ra ngoài; tin vẫn nằm DB", async () => {
    const fixture = await seedReminderFixture();
    const order = await createOrder(fixture);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const reminded = await remindPendingOrdersForSession(fixture.sessionId, {
        prisma: testPrisma,
        emit: () => {
          throw new Error("socket chết");
        },
      });
      expect(reminded).toBe(1); // vẫn tính là đã nhắc: tin đã ghi DB
      expect(await reminderRows(order.id)).toHaveLength(1);
      // Lỗi emit bị nuốt + log — không ném ra ngoài làm chết timer.
      expect(errorSpy).toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });
});
