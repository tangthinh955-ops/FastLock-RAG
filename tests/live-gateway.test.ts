import { createServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { Server } from "socket.io";
import {
  io as createClient,
  type Socket as ClientSocket,
} from "socket.io-client";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { signToken } from "../lib/auth/token";
import {
  getFakeCommentPeak,
  isFakeCommentsRunning,
  startFakeComments,
  stopFakeComments,
} from "../lib/live/fake-comments";
import {
  attachLiveGateway,
  type CommentEvent,
  type LiveClientToServerEvents,
  type LiveEndedEvent,
  type LiveServerToClientEvents,
  type LiveStartedEvent,
  type NewOrderEvent,
} from "../lib/live/gateway";
import { getIo, setIo } from "../lib/socket-registry";
import { seedBase } from "../prisma/seed/base";
import { SEED_IDS } from "../prisma/seed/ids";
import { resetDb, testPrisma } from "./helpers/db";

/**
 * Integration thật cho socket gateway `/live` (Task 10): http server + socket.io
 * cổng ngẫu nhiên + `attachLiveGateway(io, testPrisma)`, client `socket.io-client`
 * nối bằng JWT thật (`signToken`) — không mock tầng nào.
 *
 * Trọng tâm bảo mật (plan "Review Focus" #5): danh tính CHỈ lấy từ JWT; payload
 * client kèm `buyerId`/`userId`/`role` khác phải bị bỏ qua hoàn toàn.
 */

const TEST_SESSION_ID = "0f1e2d3c-4b5a-4697-8a9b-0c1d2e3f4051";
const TEST_SECRET = "gateway-test-secret";

/** Client socket đã gắn đúng event map của gateway (nhận server, gửi client). */
type TestClient = ClientSocket<LiveServerToClientEvents, LiveClientToServerEvents>;

let httpServer: HttpServer;
let io: Server;
let serverUrl: string;
const openClients: TestClient[] = [];

/** Token thật cho 3 tài khoản seed dùng xuyên test (id cố định nên không đổi). */
let tokenKhach: string;
let tokenHong: string;
let tokenLinh: string;
let tokenBaoAn: string;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Kết nối và chờ handshake xong; handshake lỗi thì reject đúng Error của server. */
function connect(auth: { token?: string }): Promise<TestClient> {
  return new Promise((resolve, reject) => {
    // socket.io-client trả Socket<DefaultEventsMap, DefaultEventsMap>; ta tự gắn
    // type của gateway để test gọi event đúng tên và đúng payload.
    const socket = createClient(serverUrl, {
      auth,
      transports: ["websocket"],
      reconnection: false,
    }) as unknown as TestClient;

    socket.once("connect", () => {
      openClients.push(socket);
      resolve(socket);
    });
    socket.once("connect_error", (error) => {
      socket.disconnect();
      reject(error);
    });
  });
}

function waitComment(socket: TestClient): Promise<CommentEvent> {
  return new Promise((resolve) => {
    socket.once("comment", resolve);
  });
}

function waitNewOrder(socket: TestClient): Promise<NewOrderEvent> {
  return new Promise((resolve) => {
    socket.once("new_order", resolve);
  });
}

function waitLiveEnded(socket: TestClient): Promise<LiveEndedEvent> {
  return new Promise((resolve) => {
    socket.once("live_ended", resolve);
  });
}

function waitLiveStarted(socket: TestClient): Promise<LiveStartedEvent> {
  return new Promise((resolve) => {
    socket.once("live_started", resolve);
  });
}

/** Chờ server-side join xong phòng `live:{id}` — hết race với send_comment. */
async function waitInRoom(socket: TestClient, sessionId: string): Promise<void> {
  await vi.waitFor(
    () => {
      const room = io.of("/live").adapter.rooms.get(`live:${sessionId}`);
      expect(room?.has(socket.id ?? "khong-co-id")).toBe(true);
    },
    { timeout: 5000 },
  );
}

/** Tạo phiên LIVE cố định của shop Linh cho mọi test. */
async function createLiveSession(): Promise<void> {
  await testPrisma.liveSession.create({
    data: { id: TEST_SESSION_ID, shopId: SEED_IDS.shops.linh, title: "Live test" },
  });
}

describe("socket gateway /live — JWT, comment → đơn, che SĐT, giả lập khách", () => {
  beforeAll(async () => {
    vi.stubEnv("JWT_SECRET", TEST_SECRET);
    vi.stubEnv("DEMO_MODE", "true");

    tokenKhach = await signToken({
      userId: SEED_IDS.users.khach,
      role: "BUYER",
      name: "Khách",
    });
    tokenHong = await signToken({
      userId: SEED_IDS.users.hong,
      role: "BUYER",
      name: "Hồng",
    });
    tokenLinh = await signToken({
      userId: SEED_IDS.users.linh,
      role: "SELLER",
      name: "Linh",
    });
    tokenBaoAn = await signToken({
      userId: SEED_IDS.users.baoan,
      role: "SELLER",
      name: "Bảo An",
    });
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    await testPrisma.$disconnect();
  });

  beforeEach(async () => {
    await resetDb();
    await seedBase(testPrisma);
    await createLiveSession();

    httpServer = createServer();
    io = new Server(httpServer);
    attachLiveGateway(io, testPrisma);
    await new Promise<void>((resolve) => {
      httpServer.listen(0, resolve);
    });
    const { port } = httpServer.address() as AddressInfo;
    serverUrl = `http://127.0.0.1:${port}/live`;
  });

  afterEach(async () => {
    for (const client of openClients.splice(0)) {
      client.disconnect();
    }
    // Không để timer giả lập rò rỉ sang test sau.
    stopFakeComments(TEST_SESSION_ID);
    await io.close();
    // State toàn cục (R18/R19) không được rò sang file test sau: io của test
    // này đã đóng, còn store fake-comments thuộc cả process.
    globalThis.__liveIo = undefined;
    globalThis.__liveFakeComments = undefined;
  });

  it("(1) thiếu token hoặc token rác → connect_error 'unauthorized'", async () => {
    await expect(connect({})).rejects.toThrow("unauthorized");
    await expect(connect({ token: "khong-phai-jwt" })).rejects.toThrow(
      "unauthorized",
    );
  });

  it("(2) buyer A join_live + 'SP01 1 cái' → nhận comment và đơn trong DB thuộc A", async () => {
    const socket = await connect({ token: tokenKhach });
    socket.emit("join_live", { sessionId: TEST_SESSION_ID });
    await waitInRoom(socket, TEST_SESSION_ID);

    const commentPromise = waitComment(socket);
    const orderPromise = waitNewOrder(socket);
    socket.emit("send_comment", {
      sessionId: TEST_SESSION_ID,
      text: "SP01 1 cái",
      nonce: "nonce-2",
    });

    const comment = await commentPromise;
    const orderEvent = await orderPromise;

    expect(comment.userId).toBe(SEED_IDS.users.khach);
    expect(comment.userName).toBe("Khách");
    expect(comment.text).toBe("SP01 1 cái");
    expect(comment.matches).toEqual([{ sku: "SP01", start: 0, end: 4 }]);
    expect(comment.kind).toBe("user");
    expect(typeof comment.createdAt).toBe("string");
    expect(Number.isFinite(comment.elapsedMs)).toBe(true);

    expect(orderEvent.buyerId).toBe(SEED_IDS.users.khach);
    expect(orderEvent.buyerName).toBe("Khách");
    expect(orderEvent.order.sku).toBe("SP01");
    expect(orderEvent.order.qty).toBe(1);
    expect(orderEvent.order.total).toBe(150_000);

    const dbOrder = await testPrisma.order.findUniqueOrThrow({
      where: { id: orderEvent.order.id },
    });
    expect(dbOrder.buyerId).toBe(SEED_IDS.users.khach);
    expect(dbOrder.liveSessionId).toBe(TEST_SESSION_ID);
    expect(dbOrder.productId).toBe(SEED_IDS.products.linh_sp01);
  });

  it("(3) giả mạo danh tính trong payload → đơn và comment vẫn thuộc buyer trong JWT", async () => {
    const socket = await connect({ token: tokenKhach });
    socket.emit("join_live", { sessionId: TEST_SESSION_ID });
    await waitInRoom(socket, TEST_SESSION_ID);

    const commentPromise = waitComment(socket);
    const orderPromise = waitNewOrder(socket);
    socket.emit("send_comment", {
      sessionId: TEST_SESSION_ID,
      text: "SP01 2 cái",
      nonce: "nonce-3",
      // Toàn bộ field danh tính giả mạo — server phải bỏ qua sạch.
      buyerId: SEED_IDS.users.hong,
      userId: SEED_IDS.users.hong,
      role: "SELLER",
      name: "Hồng",
    });

    const comment = await commentPromise;
    const orderEvent = await orderPromise;

    expect(comment.userId).toBe(SEED_IDS.users.khach);
    expect(comment.userName).toBe("Khách");
    expect(orderEvent.buyerId).toBe(SEED_IDS.users.khach);
    expect(orderEvent.buyerName).toBe("Khách");

    const dbOrder = await testPrisma.order.findUniqueOrThrow({
      where: { id: orderEvent.order.id },
    });
    expect(dbOrder.buyerId).toBe(SEED_IDS.users.khach);
    expect(
      await testPrisma.order.count({ where: { buyerId: SEED_IDS.users.hong } }),
    ).toBe(0);
  });

  it("(4) comment chứa SĐT → text phát đi đã che, highlight đúng trên chuỗi đã che", async () => {
    const socket = await connect({ token: tokenKhach });
    socket.emit("join_live", { sessionId: TEST_SESSION_ID });
    await waitInRoom(socket, TEST_SESSION_ID);

    const commentPromise = waitComment(socket);
    socket.emit("send_comment", {
      sessionId: TEST_SESSION_ID,
      text: "0912 345 678 SP01 1 cái nha",
      nonce: "nonce-4",
    });

    const comment = await commentPromise;

    expect(comment.text).toBe("0912***678 SP01 1 cái nha");
    expect(comment.text).not.toContain("0912 345 678");
    expect(comment.matches).toEqual([{ sku: "SP01", start: 11, end: 15 }]);
    expect(comment.text.slice(11, 15)).toBe("SP01");
  });

  it("(5) cùng nonce gửi 2 lần → 1 đơn trong DB, new_order đúng 1 lần", async () => {
    const socket = await connect({ token: tokenKhach });
    socket.emit("join_live", { sessionId: TEST_SESSION_ID });
    await waitInRoom(socket, TEST_SESSION_ID);

    const comments: CommentEvent[] = [];
    const orders: NewOrderEvent[] = [];
    socket.on("comment", (event) => comments.push(event));
    socket.on("new_order", (event) => orders.push(event));

    const payload = {
      sessionId: TEST_SESSION_ID,
      text: "SP01 1 cái",
      nonce: "nonce-dup",
    };

    socket.emit("send_comment", payload);
    await vi.waitFor(() => {
      expect(comments.length).toBe(1);
    }, { timeout: 5000 });

    socket.emit("send_comment", payload);
    await vi.waitFor(() => {
      expect(comments.length).toBe(2);
    }, { timeout: 5000 });

    // Cửa sổ ngắn cho mọi event thừa rơi vào (nếu bug phát đúp new_order).
    await sleep(150);

    expect(orders).toHaveLength(1);
    expect(comments[1].text).toBe("SP01 1 cái");
    expect(
      await testPrisma.order.count({
        where: { liveSessionId: TEST_SESSION_ID },
      }),
    ).toBe(1);

    const product = await testPrisma.product.findUniqueOrThrow({
      where: { id: SEED_IDS.products.linh_sp01 },
    });
    expect(product.stock).toBe(7); // kho 8, chỉ trừ đúng 1 lần
  });

  it("(6) client có token nhưng không join_live → không nhận comment nào", async () => {
    const joined = await connect({ token: tokenKhach });
    joined.emit("join_live", { sessionId: TEST_SESSION_ID });
    await waitInRoom(joined, TEST_SESSION_ID);

    const lurker = await connect({ token: tokenHong });
    const lurkerComments: CommentEvent[] = [];
    lurker.on("comment", (event) => lurkerComments.push(event));

    const commentPromise = waitComment(joined);
    joined.emit("send_comment", {
      sessionId: TEST_SESSION_ID,
      text: "SP01 1 cái",
      nonce: "nonce-6",
    });
    await commentPromise;
    await sleep(150);

    expect(lurkerComments).toHaveLength(0);
  });

  it("(7) toggle_fake: seller bật → true; buyer / seller shop khác → bỏ qua; seller tắt → false", async () => {
    const seller = await connect({ token: tokenLinh });
    const buyer = await connect({ token: tokenKhach });
    const otherSeller = await connect({ token: tokenBaoAn });

    expect(isFakeCommentsRunning(TEST_SESSION_ID)).toBe(false);

    seller.emit("toggle_fake", { sessionId: TEST_SESSION_ID, enabled: true });
    await vi.waitFor(() => {
      expect(isFakeCommentsRunning(TEST_SESSION_ID)).toBe(true);
    }, { timeout: 5000 });

    buyer.emit("toggle_fake", { sessionId: TEST_SESSION_ID, enabled: false });
    await sleep(120);
    expect(isFakeCommentsRunning(TEST_SESSION_ID)).toBe(true);

    otherSeller.emit("toggle_fake", { sessionId: TEST_SESSION_ID, enabled: false });
    await sleep(120);
    expect(isFakeCommentsRunning(TEST_SESSION_ID)).toBe(true);

    seller.emit("toggle_fake", { sessionId: TEST_SESSION_ID, enabled: false });
    await vi.waitFor(() => {
      expect(isFakeCommentsRunning(TEST_SESSION_ID)).toBe(false);
    }, { timeout: 5000 });

    // Lifecycle peak: stop giữ peak đọc được (Task 11 lấy số này lưu DB).
    expect(getFakeCommentPeak(TEST_SESSION_ID)).toBeGreaterThanOrEqual(0);
  });

  it("(7b) startFakeComments idempotent — start reset peak, tick tăng viewers, stop dừng sạch", async () => {
    vi.useFakeTimers();
    try {
      startFakeComments(io, TEST_SESSION_ID, "Shop Thời Trang Linh");
      // Gọi lại khi đang chạy: không được nhân đôi interval/timer.
      startFakeComments(io, TEST_SESSION_ID, "Shop Thời Trang Linh");

      expect(isFakeCommentsRunning(TEST_SESSION_ID)).toBe(true);
      expect(getFakeCommentPeak(TEST_SESSION_ID)).toBe(0); // start reset peak

      // Tick đầu rơi trong khoảng 4–8s → 8,1s là đủ chắc chắn.
      await vi.advanceTimersByTimeAsync(8100);
      expect(getFakeCommentPeak(TEST_SESSION_ID)).toBeGreaterThan(0);

      stopFakeComments(TEST_SESSION_ID);
      expect(isFakeCommentsRunning(TEST_SESSION_ID)).toBe(false);
      const peakAfterStop = getFakeCommentPeak(TEST_SESSION_ID);
      expect(peakAfterStop).toBeGreaterThan(0);

      // Stop rồi thì không timer nào còn chạy được nữa.
      await vi.advanceTimersByTimeAsync(30_000);
      expect(getFakeCommentPeak(TEST_SESSION_ID)).toBe(peakAfterStop);
      expect(isFakeCommentsRunning(TEST_SESSION_ID)).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("(8) input không hợp lệ → comment system 'Tin nhắn không hợp lệ' riêng cho người gửi", async () => {
    const sender = await connect({ token: tokenKhach });
    sender.emit("join_live", { sessionId: TEST_SESSION_ID });
    await waitInRoom(sender, TEST_SESSION_ID);

    const observer = await connect({ token: tokenHong });
    observer.emit("join_live", { sessionId: TEST_SESSION_ID });
    await waitInRoom(observer, TEST_SESSION_ID);
    const observerComments: CommentEvent[] = [];
    observer.on("comment", (event) => observerComments.push(event));

    // Text dài hơn 200 ký tự.
    const tooLongPromise = waitComment(sender);
    sender.emit("send_comment", {
      sessionId: TEST_SESSION_ID,
      text: "a".repeat(201),
    });
    const tooLong = await tooLongPromise;
    expect(tooLong).toMatchObject({
      kind: "system",
      userId: "system",
      userName: "Hệ thống",
      text: "Tin nhắn không hợp lệ",
    });
    expect(tooLong.matches).toEqual([]);
    expect(tooLong.elapsedMs).toBeUndefined();

    // Thiếu hẳn sessionId.
    const missingSessionPromise = waitComment(sender);
    sender.emit("send_comment", { text: "SP01 1 cái" });
    const missingSession = await missingSessionPromise;
    expect(missingSession).toMatchObject({
      kind: "system",
      text: "Tin nhắn không hợp lệ",
    });

    // Text trắng → EMPTY_TEXT từ service, cùng thông báo.
    const emptyPromise = waitComment(sender);
    sender.emit("send_comment", {
      sessionId: TEST_SESSION_ID,
      text: "   ",
      nonce: "nonce-8",
    });
    const empty = await emptyPromise;
    expect(empty).toMatchObject({
      kind: "system",
      text: "Tin nhắn không hợp lệ",
    });

    await sleep(150);
    expect(observerComments).toHaveLength(0); // lỗi không phát vào phòng
    expect(await testPrisma.order.count()).toBe(0);
  });

  it("(9) join_live / send_comment với phiên không LIVE → live_ended riêng cho client đó", async () => {
    await testPrisma.liveSession.update({
      where: { id: TEST_SESSION_ID },
      data: { status: "ENDED", endedAt: new Date() },
    });

    const socket = await connect({ token: tokenKhach });

    const endedOnJoin = waitLiveEnded(socket);
    socket.emit("join_live", { sessionId: TEST_SESSION_ID });
    expect((await endedOnJoin).sessionId).toBe(TEST_SESSION_ID);

    const endedOnComment = waitLiveEnded(socket);
    socket.emit("send_comment", {
      sessionId: TEST_SESSION_ID,
      text: "SP01 1 cái",
      nonce: "nonce-9",
    });
    expect((await endedOnComment).sessionId).toBe(TEST_SESSION_ID);
    expect(await testPrisma.order.count()).toBe(0);

    // Phiên không tồn tại cũng báo live_ended (không join phòng).
    const endedOnMissing = waitLiveEnded(socket);
    socket.emit("join_live", { sessionId: "khong-ton-tai" });
    expect((await endedOnMissing).sessionId).toBe("khong-ton-tai");

    // Không ai được vào phòng của phiên đã ENDED / không tồn tại.
    const roomSize =
      io.of("/live").adapter.rooms.get(`live:${TEST_SESSION_ID}`)?.size ?? 0;
    expect(roomSize).toBe(0);
  });

  it("(10) hết hàng → comment người gửi + comment system '{sku} đã hết hàng', không tạo đơn", async () => {
    const socket = await connect({ token: tokenKhach });
    socket.emit("join_live", { sessionId: TEST_SESSION_ID });
    await waitInRoom(socket, TEST_SESSION_ID);

    const comments: CommentEvent[] = [];
    const orders: NewOrderEvent[] = [];
    socket.on("comment", (event) => comments.push(event));
    socket.on("new_order", (event) => orders.push(event));

    socket.emit("send_comment", {
      sessionId: TEST_SESSION_ID,
      text: "SP06 5 cái",
      nonce: "nonce-10",
    });

    await vi.waitFor(() => {
      expect(comments.length).toBe(2);
    }, { timeout: 5000 });
    await sleep(120);

    expect(comments[0]).toMatchObject({
      kind: "user",
      text: "SP06 5 cái",
      matches: [{ sku: "SP06", start: 0, end: 4 }],
    });
    expect(comments[1]).toMatchObject({
      kind: "system",
      userId: "system",
      text: "SP06 đã hết hàng",
    });
    expect(orders).toHaveLength(0);

    const product = await testPrisma.product.findUniqueOrThrow({
      where: { id: SEED_IDS.products.linh_sp06 },
    });
    expect(product.stock).toBe(3); // kho nguyên vẹn
    expect(await testPrisma.order.count()).toBe(0);
  });

  it("(11) setIo/getIo — REST cùng process phát live_started toàn namespace qua registry", async () => {
    setIo(io);
    expect(getIo()).toBe(io);

    const viewer = await connect({ token: tokenKhach });
    const startedPromise = waitLiveStarted(viewer);
    io.of("/live").emit("live_started", {
      session: {
        id: TEST_SESSION_ID,
        title: "Live thử",
        shopName: "Shop Thời Trang Linh",
      },
    });

    const started = await startedPromise;
    expect(started.session).toEqual({
      id: TEST_SESSION_ID,
      title: "Live thử",
      shopName: "Shop Thời Trang Linh",
    });
  });
});
