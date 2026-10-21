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
import type { AiAnswer, AiRunner, AiRunnerInput, AiTrace } from "../lib/chat/ai";
import {
  attachInboxGateway,
  type InboxAiThinkingEvent,
  type InboxClientToServerEvents,
  type InboxConversationEvent,
  type InboxErrorEvent,
  type InboxMessageEvent,
  type InboxServerToClientEvents,
} from "../lib/chat/gateway";
import {
  conversationRoom,
  getInboxIo,
  INBOX_NAMESPACE,
  setInboxIo,
  shopInboxRoom,
} from "../lib/socket-registry";
import { seedBase } from "../prisma/seed/base";
import { SEED_IDS } from "../prisma/seed/ids";
import { resetDb, testPrisma } from "./helpers/db";

/**
 * Integration thật cho socket gateway `/inbox` (Task 7): http server + socket.io
 * cổng ngẫu nhiên + `attachInboxGateway(io, testPrisma, { aiRunner })`, client
 * `socket.io-client` nối bằng JWT thật (`signToken`) — không mock tầng nào trừ
 * runner AI (bắt buộc: test không được gọi Groq).
 *
 * Trọng tâm (plan "Review Focus" #2): TAKEOVER THẮNG cả khi AI đang bay — tin AI
 * về muộn (thành công HAY lỗi) bị hủy IM LẶNG: không lưu DB, không phát socket.
 * Kèm chống trùng `clientNonce`, quyền join/send theo JWT (payload giả bị bỏ
 * qua), và vai trò seller-only của `hand_back_to_ai`.
 */

/** Hội thoại chính: Khách (buyer) ↔ shop Linh — nơi diễn mọi ca tin nhắn. */
const CONV_KHACH_LINH = "7a11c0de-0001-4a00-8b00-000000000001";
/** Hội thoại của người khác: Hồng ↔ shop Bảo An — mọi truy cập từ ngoài phải bị chặn. */
const CONV_HONG_BAOAN = "7a11c0de-0002-4a00-8b00-000000000002";

const TEST_SECRET = "inbox-gateway-test-secret";

/** Client socket đã gắn đúng event map của gateway (nhận server, gửi client). */
type TestClient = ClientSocket<InboxServerToClientEvents, InboxClientToServerEvents>;

let httpServer: HttpServer | undefined;
let io: Server | undefined;
let serverUrl: string;
const openClients: TestClient[] = [];

/** Token thật cho 4 tài khoản seed dùng xuyên test (id cố định nên không đổi). */
let tokenKhach: string; // BUYER — chủ CONV_KHACH_LINH
let tokenHong: string; // BUYER — chủ CONV_HONG_BAOAN
let tokenLinh: string; // SELLER — chủ shop Linh
let tokenBaoAn: string; // SELLER — chủ shop Bảo An (shop khác)

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Runner giả có "cổng" điều khiển: mỗi lần `answer` ghi lại input rồi treo ở
 * một promise cho test tự resolve/reject — đúng cách dựng cửa sổ race takeover
 * mà không phụ thuộc thời gian thật.
 */
type Gate = { resolve: (answer: AiAnswer) => void; reject: (error: unknown) => void };

function createGatedRunner(): {
  runner: AiRunner;
  calls: AiRunnerInput[];
  gates: Gate[];
} {
  const calls: AiRunnerInput[] = [];
  const gates: Gate[] = [];
  const runner: AiRunner = {
    async answer(prisma, input): Promise<AiAnswer> {
      void prisma; // test không dùng prisma thật của runner
      calls.push(input);
      return await new Promise<AiAnswer>((resolve, reject) => {
        gates.push({ resolve, reject });
      });
    },
  };
  return { runner, calls, gates };
}

/** Runner trả lời ngay với nội dung cố định — ca không cần điều khiển thời gian. */
function createInstantRunner(content: string): {
  runner: AiRunner;
  calls: AiRunnerInput[];
} {
  const calls: AiRunnerInput[] = [];
  const runner: AiRunner = {
    async answer(prisma, input): Promise<AiAnswer> {
      void prisma;
      calls.push(input);
      return fakeAnswer(content);
    },
  };
  return { runner, calls };
}

/** Trace tối thiểu đủ shape `AiTrace` — không cần DB/RAG cho test gateway. */
function fakeTrace(): AiTrace {
  return {
    model: "fake-model",
    topK: [],
    products: [],
    tokens: { prompt: 1, completion: 1 },
    elapsedMs: 1,
  };
}

function fakeAnswer(content: string): AiAnswer {
  return { content, trace: fakeTrace() };
}

/** Kết nối và chờ handshake xong; handshake lỗi thì reject đúng Error của server. */
function connect(auth: { token?: string }): Promise<TestClient> {
  return new Promise((resolve, reject) => {
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

function waitInboxError(socket: TestClient): Promise<InboxErrorEvent> {
  return new Promise((resolve) => {
    socket.once("inbox_error", resolve);
  });
}

function waitConversationUpdated(socket: TestClient): Promise<InboxConversationEvent> {
  return new Promise((resolve) => {
    socket.once("conversation_updated", resolve);
  });
}

/** Danh sách socket id đang có trong một phòng của namespace `/inbox`. */
function roomMembers(room: string): Set<string> {
  const nsp = io?.of(INBOX_NAMESPACE);
  return nsp?.adapter.rooms.get(room) ?? new Set<string>();
}

/** Chờ server-side join xong phòng — hết race với emit ngay sau đó. */
async function waitInRoom(socket: TestClient, room: string): Promise<void> {
  await vi.waitFor(
    () => {
      expect(roomMembers(room).has(socket.id ?? "khong-co-id")).toBe(true);
    },
    { timeout: 5000 },
  );
}

/** Dựng io server in-process với runner chỉ định — mỗi test tự chọn runner. */
async function startServer(runner: AiRunner): Promise<void> {
  httpServer = createServer();
  io = new Server(httpServer);
  attachInboxGateway(io, testPrisma, { aiRunner: runner });
  await new Promise<void>((resolve) => {
    httpServer?.listen(0, resolve);
  });
  const { port } = httpServer.address() as AddressInfo;
  serverUrl = `http://127.0.0.1:${port}/inbox`;
}

/** Hai hội thoại nền: chính (Khách↔Linh) + của người khác (Hồng↔Bảo An). */
async function seedConversations(): Promise<void> {
  await testPrisma.conversation.create({
    data: {
      id: CONV_KHACH_LINH,
      buyerId: SEED_IDS.users.khach,
      shopId: SEED_IDS.shops.linh,
    },
  });
  await testPrisma.conversation.create({
    data: {
      id: CONV_HONG_BAOAN,
      buyerId: SEED_IDS.users.hong,
      shopId: SEED_IDS.shops.baoan,
    },
  });
}

function sourcesOf(events: InboxMessageEvent[]): string[] {
  return events.map((event) => event.message.source);
}

describe("socket gateway /inbox — JWT, tin nhắn, takeover hủy im lặng, chống trùng", () => {
  beforeAll(async () => {
    vi.stubEnv("JWT_SECRET", TEST_SECRET);

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
    await seedConversations();
  });

  afterEach(async () => {
    for (const client of openClients.splice(0)) {
      client.disconnect();
    }
    await io?.close();
    httpServer = undefined;
    io = undefined;
    // State toàn cục (R18/R19) không được rò sang file test sau.
    globalThis.__inboxIo = undefined;
  });

  it("(1) thiếu token / token rác / seller không có shop → connect bị từ chối", async () => {
    await startServer(createInstantRunner("không dùng").runner);

    await expect(connect({})).rejects.toThrow("unauthorized");
    await expect(connect({ token: "khong-phai-jwt" })).rejects.toThrow(
      "unauthorized",
    );

    // SELLER hợp lệ nhưng không sở hữu shop nào → từ chối ở handshake.
    const noShop = await testPrisma.user.create({
      data: {
        email: "vo-chu@test.vn",
        passwordHash: "x",
        name: "Vô chủ",
        role: "SELLER",
      },
    });
    const tokenNoShop = await signToken({
      userId: noShop.id,
      role: "SELLER",
      name: noShop.name,
    });
    await expect(connect({ token: tokenNoShop })).rejects.toThrow("forbidden");
  });

  it("(2) join hội thoại người khác → inbox_error riêng, không vào phòng; chủ join → vào phòng + conversation_updated hiện trạng", async () => {
    await startServer(createInstantRunner("không dùng").runner);

    // Hồng tự nhận là Khách trong payload — danh tính phải lấy từ JWT, không phải payload.
    const hong = await connect({ token: tokenHong });
    const errorPromise = waitInboxError(hong);
    hong.emit("join_conversation", {
      conversationId: CONV_KHACH_LINH,
      buyerId: SEED_IDS.users.khach,
      role: "SELLER",
    });
    const error = await errorPromise;
    expect(error.conversationId).toBe(CONV_KHACH_LINH);
    expect(typeof error.message).toBe("string");
    expect(error.message.length).toBeGreaterThan(0);

    await sleep(120);
    expect(roomMembers(conversationRoom(CONV_KHACH_LINH)).has(hong.id ?? "")).toBe(
      false,
    );

    // Chủ thật join được; nhận luôn hiện trạng mode/version để UI dựng đúng chế độ.
    const khach = await connect({ token: tokenKhach });
    const updatedPromise = waitConversationUpdated(khach);
    khach.emit("join_conversation", { conversationId: CONV_KHACH_LINH });
    expect(await updatedPromise).toEqual({
      conversationId: CONV_KHACH_LINH,
      mode: "AI",
      version: 1,
    });
    await waitInRoom(khach, conversationRoom(CONV_KHACH_LINH));
  });

  it("(3) buyer gửi → buyer (phòng hội thoại) + seller (phòng shop) cùng nhận `message`; gửi lại cùng clientNonce → không thêm tin, không chạy AI lần hai", async () => {
    const instant = createInstantRunner("Dạ shop còn hàng nhé");
    await startServer(instant.runner);

    const khach = await connect({ token: tokenKhach });
    const buyerMessages: InboxMessageEvent[] = [];
    khach.on("message", (event) => buyerMessages.push(event));
    khach.emit("join_conversation", { conversationId: CONV_KHACH_LINH });
    await waitInRoom(khach, conversationRoom(CONV_KHACH_LINH));

    // Seller chỉ connect — tự vào phòng shop, KHÔNG join_conversation.
    const linh = await connect({ token: tokenLinh });
    const sellerMessages: InboxMessageEvent[] = [];
    linh.on("message", (event) => sellerMessages.push(event));
    await waitInRoom(linh, shopInboxRoom(SEED_IDS.shops.linh));

    khach.emit("send_message", {
      conversationId: CONV_KHACH_LINH,
      content: "SP01 còn hàng không shop?",
      clientNonce: "nonce-3",
    });

    await vi.waitFor(
      () => {
        expect(buyerMessages.filter((e) => e.message.source === "BUYER")).toHaveLength(1);
      },
      { timeout: 5000 },
    );
    await vi.waitFor(
      () => {
        expect(sellerMessages.filter((e) => e.message.source === "BUYER")).toHaveLength(1);
      },
      { timeout: 5000 },
    );

    const buyerRow = buyerMessages.find((e) => e.message.source === "BUYER")!.message;
    expect(buyerRow.conversationId).toBe(CONV_KHACH_LINH);
    expect(buyerRow.content).toBe("SP01 còn hàng không shop?");
    expect(Number.isFinite(Date.parse(buyerRow.createdAt))).toBe(true);

    // AI (fake) trả lời ngay → tin AI kèm trace xuống cả hai bên.
    await vi.waitFor(
      () => {
        expect(buyerMessages.filter((e) => e.message.source === "AI")).toHaveLength(1);
      },
      { timeout: 5000 },
    );
    const aiRow = buyerMessages.find((e) => e.message.source === "AI")!.message;
    expect(aiRow.content).toBe("Dạ shop còn hàng nhé");
    expect(aiRow.trace).toEqual(fakeTrace());

    // Gửi LẠI y hệt (cùng nonce): dedupKey unique → dừng im lặng.
    khach.emit("send_message", {
      conversationId: CONV_KHACH_LINH,
      content: "SP01 còn hàng không shop?",
      clientNonce: "nonce-3",
    });
    await sleep(250);

    expect(buyerMessages.filter((e) => e.message.source === "BUYER")).toHaveLength(1);
    expect(sellerMessages.filter((e) => e.message.source === "BUYER")).toHaveLength(1);
    expect(buyerMessages.filter((e) => e.message.source === "AI")).toHaveLength(1);
    expect(instant.calls).toHaveLength(1);

    expect(await testPrisma.directMessage.count({ where: { source: "BUYER" } })).toBe(1);
    const dedupRow = await testPrisma.directMessage.findFirstOrThrow({
      where: { dedupKey: `msg:${CONV_KHACH_LINH}:nonce-3` },
    });
    expect(dedupRow.content).toBe("SP01 còn hàng không shop?");
  });

  it("(4) content trắng / quá 2000 ký tự → inbox_error, không lưu gì, không gọi AI", async () => {
    const instant = createInstantRunner("không dùng");
    await startServer(instant.runner);

    const khach = await connect({ token: tokenKhach });
    khach.emit("join_conversation", { conversationId: CONV_KHACH_LINH });
    await waitInRoom(khach, conversationRoom(CONV_KHACH_LINH));

    const emptyError = waitInboxError(khach);
    khach.emit("send_message", { conversationId: CONV_KHACH_LINH, content: "   " });
    const empty = await emptyError;
    expect(empty.conversationId).toBe(CONV_KHACH_LINH);
    expect(typeof empty.message).toBe("string");

    const longError = waitInboxError(khach);
    khach.emit("send_message", {
      conversationId: CONV_KHACH_LINH,
      content: "a".repeat(2001),
    });
    expect((await longError).conversationId).toBe(CONV_KHACH_LINH);

    await sleep(150);
    expect(await testPrisma.directMessage.count()).toBe(0);
    expect(instant.calls).toHaveLength(0);
  });

  it("(5) RACE takeover: seller gõ khi AI đang bay → AI về muộn bị hủy IM LẶNG (không row, không event); ai_thinking tắt; mode HUMAN/version 2", async () => {
    const gated = createGatedRunner();
    await startServer(gated.runner);

    const khach = await connect({ token: tokenKhach });
    const linh = await connect({ token: tokenLinh });

    const buyerMessages: InboxMessageEvent[] = [];
    const sellerMessages: InboxMessageEvent[] = [];
    const buyerThinking: InboxAiThinkingEvent[] = [];
    const buyerUpdates: InboxConversationEvent[] = [];
    khach.on("message", (event) => buyerMessages.push(event));
    khach.on("ai_thinking", (event) => buyerThinking.push(event));
    khach.on("conversation_updated", (event) => buyerUpdates.push(event));
    linh.on("message", (event) => sellerMessages.push(event));

    khach.emit("join_conversation", { conversationId: CONV_KHACH_LINH });
    linh.emit("join_conversation", { conversationId: CONV_KHACH_LINH });
    await waitInRoom(khach, conversationRoom(CONV_KHACH_LINH));
    await waitInRoom(linh, conversationRoom(CONV_KHACH_LINH));

    // Buyer hỏi → AI bắt đầu chạy và bị "treo" ở cổng.
    khach.emit("send_message", {
      conversationId: CONV_KHACH_LINH,
      content: "Tư vấn giúp mình bộ này",
      clientNonce: "nonce-race",
    });
    await vi.waitFor(
      () => {
        expect(gated.gates).toHaveLength(1);
      },
      { timeout: 5000 },
    );
    expect(gated.calls[0].text).toBe("Tư vấn giúp mình bộ này");
    // Hội thoại chỉ có câu hỏi hiện tại → history RỖNG (câu hỏi được truyền
    // riêng qua `text`, không lặp lại trong history — Plan 3 T6).
    expect(gated.calls[0].history).toEqual([]);
    await vi.waitFor(
      () => {
        expect(buyerThinking.map((e) => e.thinking)).toEqual([true]);
      },
      { timeout: 5000 },
    );

    // Seller tiếp quản GIỮA LÚC AI đang bay.
    linh.emit("send_message", {
      conversationId: CONV_KHACH_LINH,
      content: "Shop trả lời trực tiếp nhé",
      clientNonce: "nonce-takeover",
    });
    await vi.waitFor(
      () => {
        expect(sourcesOf(sellerMessages)).toEqual(["BUYER", "SELLER"]);
      },
      { timeout: 5000 },
    );
    await vi.waitFor(
      () => {
        expect(buyerUpdates).toEqual([
          { conversationId: CONV_KHACH_LINH, mode: "AI", version: 1 }, // lúc join
          { conversationId: CONV_KHACH_LINH, mode: "HUMAN", version: 2 }, // takeover
        ]);
      },
      { timeout: 5000 },
    );

    // AI "trả lời" sau đó — nhưng hội thoại đã HUMAN/version 2 → hủy im lặng.
    gated.gates[0].resolve(fakeAnswer("Tin AI đến muộn — phải bị hủy"));
    await vi.waitFor(
      () => {
        expect(buyerThinking.map((e) => e.thinking)).toEqual([true, false]);
      },
      { timeout: 5000 },
    );
    await sleep(250); // cửa sổ cho mọi event rò rỉ (nếu bug phát tin AI muộn)

    expect(sourcesOf(buyerMessages)).toEqual(["BUYER", "SELLER"]);
    expect(sourcesOf(sellerMessages)).toEqual(["BUYER", "SELLER"]);
    expect(
      buyerMessages.some((e) => e.message.content.includes("Tin AI đến muộn")),
    ).toBe(false);

    expect(await testPrisma.directMessage.count({ where: { source: "AI" } })).toBe(0);
    expect(
      await testPrisma.directMessage.count({ where: { conversationId: CONV_KHACH_LINH } }),
    ).toBe(2);
    const conversation = await testPrisma.conversation.findUniqueOrThrow({
      where: { id: CONV_KHACH_LINH },
    });
    expect(conversation.mode).toBe("HUMAN");
    expect(conversation.version).toBe(2);
  });

  it("(6) hội thoại đang HUMAN → tin buyer vẫn lưu/phát nhưng KHÔNG có ai_thinking, không gọi AI", async () => {
    const instant = createInstantRunner("không dùng");
    await startServer(instant.runner);
    await testPrisma.conversation.update({
      where: { id: CONV_KHACH_LINH },
      data: { mode: "HUMAN", version: 2 },
    });

    const khach = await connect({ token: tokenKhach });
    const messages: InboxMessageEvent[] = [];
    const thinking: InboxAiThinkingEvent[] = [];
    khach.on("message", (event) => messages.push(event));
    khach.on("ai_thinking", (event) => thinking.push(event));
    khach.emit("join_conversation", { conversationId: CONV_KHACH_LINH });
    await waitInRoom(khach, conversationRoom(CONV_KHACH_LINH));

    khach.emit("send_message", {
      conversationId: CONV_KHACH_LINH,
      content: "Shop ơi còn ai không?",
      clientNonce: "nonce-6",
    });
    await vi.waitFor(
      () => {
        expect(sourcesOf(messages)).toEqual(["BUYER"]);
      },
      { timeout: 5000 },
    );
    await sleep(200);

    expect(thinking).toHaveLength(0);
    expect(instant.calls).toHaveLength(0);
    expect(await testPrisma.directMessage.count({ where: { source: "AI" } })).toBe(0);
    const conversation = await testPrisma.conversation.findUniqueOrThrow({
      where: { id: CONV_KHACH_LINH },
    });
    expect(conversation.mode).toBe("HUMAN");
    expect(conversation.version).toBe(2);
  });

  it("(7) seller `hand_back_to_ai` → mode AI/version mới; buyer gửi tiếp → AI (fake) trả lời được", async () => {
    const instant = createInstantRunner("Đây là trả lời AI sau khi trả lại");
    await startServer(instant.runner);
    // Trạng thái đã bị takeover từ trước: HUMAN/version 2.
    await testPrisma.conversation.update({
      where: { id: CONV_KHACH_LINH },
      data: { mode: "HUMAN", version: 2 },
    });

    const khach = await connect({ token: tokenKhach });
    const linh = await connect({ token: tokenLinh });
    const buyerUpdates: InboxConversationEvent[] = [];
    const messages: InboxMessageEvent[] = [];
    khach.on("conversation_updated", (event) => buyerUpdates.push(event));
    khach.on("message", (event) => messages.push(event));

    khach.emit("join_conversation", { conversationId: CONV_KHACH_LINH });
    linh.emit("join_conversation", { conversationId: CONV_KHACH_LINH });
    await waitInRoom(khach, conversationRoom(CONV_KHACH_LINH));
    await waitInRoom(linh, conversationRoom(CONV_KHACH_LINH));

    linh.emit("hand_back_to_ai", { conversationId: CONV_KHACH_LINH });
    await vi.waitFor(
      () => {
        expect(buyerUpdates).toEqual([
          { conversationId: CONV_KHACH_LINH, mode: "HUMAN", version: 2 }, // lúc join
          { conversationId: CONV_KHACH_LINH, mode: "AI", version: 3 }, // trả lại AI
        ]);
      },
      { timeout: 5000 },
    );

    khach.emit("send_message", {
      conversationId: CONV_KHACH_LINH,
      content: "Vậy cho mình hỏi size",
      clientNonce: "nonce-7",
    });
    await vi.waitFor(
      () => {
        expect(messages.some((e) => e.message.source === "AI")).toBe(true);
      },
      { timeout: 5000 },
    );

    const aiRow = messages.find((e) => e.message.source === "AI")!.message;
    expect(aiRow.content).toBe("Đây là trả lời AI sau khi trả lại");
    expect(instant.calls).toHaveLength(1);
    const conversation = await testPrisma.conversation.findUniqueOrThrow({
      where: { id: CONV_KHACH_LINH },
    });
    expect(conversation.mode).toBe("AI");
    expect(conversation.version).toBe(3);
  });

  it("(8) quyền: buyer không được `hand_back_to_ai`; seller shop khác không gửi được vào hội thoại", async () => {
    await startServer(createInstantRunner("không dùng").runner);

    const khach = await connect({ token: tokenKhach });
    khach.emit("join_conversation", { conversationId: CONV_KHACH_LINH });
    await waitInRoom(khach, conversationRoom(CONV_KHACH_LINH));

    // Buyer gọi hand_back_to_ai → inbox_error, mode giữ nguyên.
    const handBackError = waitInboxError(khach);
    khach.emit("hand_back_to_ai", { conversationId: CONV_KHACH_LINH });
    expect((await handBackError).conversationId).toBe(CONV_KHACH_LINH);

    // Seller shop Bảo An gửi vào hội thoại shop Linh → inbox_error, không có tin SELLER.
    const baoAn = await connect({ token: tokenBaoAn });
    const sellerError = waitInboxError(baoAn);
    baoAn.emit("send_message", {
      conversationId: CONV_KHACH_LINH,
      content: "Tin không được phép",
    });
    expect((await sellerError).conversationId).toBe(CONV_KHACH_LINH);

    await sleep(150);
    expect(await testPrisma.directMessage.count({ where: { source: "SELLER" } })).toBe(0);
    const conversation = await testPrisma.conversation.findUniqueOrThrow({
      where: { id: CONV_KHACH_LINH },
    });
    expect(conversation.mode).toBe("AI");
    expect(conversation.version).toBe(1);
  });

  it("(9) runner ném lỗi bất ngờ (không takeover) → tin AI xin lỗi + trace.error; ai_thinking luôn tắt false", async () => {
    const gated = createGatedRunner();
    await startServer(gated.runner);

    const khach = await connect({ token: tokenKhach });
    const messages: InboxMessageEvent[] = [];
    const thinking: InboxAiThinkingEvent[] = [];
    khach.on("message", (event) => messages.push(event));
    khach.on("ai_thinking", (event) => thinking.push(event));
    khach.emit("join_conversation", { conversationId: CONV_KHACH_LINH });
    await waitInRoom(khach, conversationRoom(CONV_KHACH_LINH));

    khach.emit("send_message", {
      conversationId: CONV_KHACH_LINH,
      content: "Câu hỏi bình thường",
      clientNonce: "nonce-9",
    });
    await vi.waitFor(
      () => {
        expect(gated.gates).toHaveLength(1);
      },
      { timeout: 5000 },
    );
    gated.gates[0].reject(new Error("DB bất ngờ hỏng"));

    await vi.waitFor(
      () => {
        expect(thinking.map((e) => e.thinking)).toEqual([true, false]);
      },
      { timeout: 5000 },
    );
    expect(sourcesOf(messages)).toEqual(["BUYER", "AI"]);
    const apology = messages.find((e) => e.message.source === "AI")!.message;
    expect(apology.content).toContain("Xin lỗi");
    expect(apology.content).not.toContain("DB bất ngờ hỏng"); // nội dung cho khách không lộ chi tiết nội bộ
    expect(apology.trace).toMatchObject({ error: "DB bất ngờ hỏng" }); // còn khối truy vết kỹ thuật thì có

    expect(await testPrisma.directMessage.count({ where: { source: "AI" } })).toBe(1);
    const conversation = await testPrisma.conversation.findUniqueOrThrow({
      where: { id: CONV_KHACH_LINH },
    });
    expect(conversation.mode).toBe("AI");
    expect(conversation.version).toBe(1);
  });

  it("(10) runner lỗi SAU khi seller tiếp quản → vẫn hủy im lặng (không tin xin lỗi nào)", async () => {
    const gated = createGatedRunner();
    await startServer(gated.runner);

    const khach = await connect({ token: tokenKhach });
    const linh = await connect({ token: tokenLinh });
    const messages: InboxMessageEvent[] = [];
    const thinking: InboxAiThinkingEvent[] = [];
    khach.on("message", (event) => messages.push(event));
    khach.on("ai_thinking", (event) => thinking.push(event));
    khach.emit("join_conversation", { conversationId: CONV_KHACH_LINH });
    linh.emit("join_conversation", { conversationId: CONV_KHACH_LINH });
    await waitInRoom(khach, conversationRoom(CONV_KHACH_LINH));
    await waitInRoom(linh, conversationRoom(CONV_KHACH_LINH));

    khach.emit("send_message", {
      conversationId: CONV_KHACH_LINH,
      content: "AI ơi tư vấn",
      clientNonce: "nonce-10",
    });
    await vi.waitFor(
      () => {
        expect(gated.gates).toHaveLength(1);
      },
      { timeout: 5000 },
    );

    linh.emit("send_message", {
      conversationId: CONV_KHACH_LINH,
      content: "Shop đây, để mình tư vấn",
      clientNonce: "nonce-10b",
    });
    await vi.waitFor(
      () => {
        expect(sourcesOf(messages)).toEqual(["BUYER", "SELLER"]);
      },
      { timeout: 5000 },
    );

    gated.gates[0].reject(new Error("Groq sập giữa chừng"));
    await vi.waitFor(
      () => {
        expect(thinking.map((e) => e.thinking)).toEqual([true, false]);
      },
      { timeout: 5000 },
    );
    await sleep(250);

    expect(sourcesOf(messages)).toEqual(["BUYER", "SELLER"]);
    expect(await testPrisma.directMessage.count({ where: { source: "AI" } })).toBe(0);
  });

  it("(11) history gửi runner KHÔNG chứa câu hỏi hiện tại nhưng vẫn giữ tin cũ", async () => {
    // Tin cũ có trước câu hỏi hiện tại — phải còn nguyên trong history.
    await testPrisma.directMessage.create({
      data: {
        conversationId: CONV_KHACH_LINH,
        source: "BUYER",
        content: "Tin cũ của khách",
      },
    });
    const instant = createInstantRunner("Dạ còn hàng");
    await startServer(instant.runner);

    const khach = await connect({ token: tokenKhach });
    khach.emit("join_conversation", { conversationId: CONV_KHACH_LINH });
    await waitInRoom(khach, conversationRoom(CONV_KHACH_LINH));

    khach.emit("send_message", {
      conversationId: CONV_KHACH_LINH,
      content: "Câu hỏi hiện tại",
      clientNonce: "nonce-11",
    });
    await vi.waitFor(
      () => {
        expect(instant.calls).toHaveLength(1);
      },
      { timeout: 5000 },
    );

    expect(instant.calls[0].text).toBe("Câu hỏi hiện tại");
    expect(instant.calls[0].history).toEqual([
      { source: "BUYER", content: "Tin cũ của khách" },
    ]);
  });

  it("(12) clientNonce > 100 ký tự bị bỏ qua (không dedup nhầm); nonce thường vẫn dedup", async () => {
    const instant = createInstantRunner("Dạ vâng");
    await startServer(instant.runner);

    const khach = await connect({ token: tokenKhach });
    khach.emit("join_conversation", { conversationId: CONV_KHACH_LINH });
    await waitInRoom(khach, conversationRoom(CONV_KHACH_LINH));

    const longNonce = "n".repeat(101);
    khach.emit("send_message", {
      conversationId: CONV_KHACH_LINH,
      content: "Tin trùng nội dung",
      clientNonce: longNonce,
    });
    await vi.waitFor(
      async () => {
        expect(
          await testPrisma.directMessage.count({ where: { source: "BUYER" } }),
        ).toBe(1);
      },
      { timeout: 5000 },
    );

    // Gửi LẠI y hệt với cùng nonce dài: nếu nonce còn được dùng làm khoá dedup
    // thì tin thứ hai bị nuốt — brief yêu cầu nonce > 100 ký tự bị coi như
    // KHÔNG có nonce nên cả hai tin đều phải lưu.
    khach.emit("send_message", {
      conversationId: CONV_KHACH_LINH,
      content: "Tin trùng nội dung",
      clientNonce: longNonce,
    });
    await vi.waitFor(
      async () => {
        expect(
          await testPrisma.directMessage.count({ where: { source: "BUYER" } }),
        ).toBe(2);
      },
      { timeout: 5000 },
    );

    // Nonce 20 ký tự vẫn dedup như cũ: gửi hai lần chỉ lưu một tin.
    const normalNonce = "n".repeat(20);
    khach.emit("send_message", {
      conversationId: CONV_KHACH_LINH,
      content: "Tin có nonce thường",
      clientNonce: normalNonce,
    });
    await vi.waitFor(
      async () => {
        expect(
          await testPrisma.directMessage.count({ where: { source: "BUYER" } }),
        ).toBe(3);
      },
      { timeout: 5000 },
    );
    khach.emit("send_message", {
      conversationId: CONV_KHACH_LINH,
      content: "Tin có nonce thường",
      clientNonce: normalNonce,
    });
    await sleep(250);
    expect(
      await testPrisma.directMessage.count({ where: { source: "BUYER" } }),
    ).toBe(3);
  });

  it("(13) setInboxIo/getInboxIo — registry globalThis cho REST phát sự kiện cùng process", async () => {
    await startServer(createInstantRunner("không dùng").runner);

    setInboxIo(io!);
    expect(getInboxIo()).toBe(io);
  });
});
