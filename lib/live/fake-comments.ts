import { randomInt } from "node:crypto";
import type { Server } from "socket.io";
import { LIVE_NAMESPACE, liveRoom } from "../socket-registry";
import type { CommentEvent, ViewersEvent } from "./gateway";

/**
 * "Giả lập khách" (spec §8.7, brief Task 10): server tự đẩy comment mẫu tiếng
 * Việt + số người xem ảo để khung chat sinh động khi demo. Chỉ chạy khi
 * `DEMO_MODE === 'true'`; nút 🎭 trong Studio (Task 13) bật/tắt qua sự kiện
 * `toggle_fake`, REST endLive (Task 11) gọi `stopFakeComments` + đọc
 * `getFakeCommentPeak` để lưu `peakViewers`.
 *
 * Quyết định đã chốt (khác "gợi ý" trong brief, theo spec §8.7):
 * - **Fake comments là CHATTER, không chạy qua `processComment`** — spec §8.7 nói
 *   rõ mục đích "để khung chat sinh động", không nói tạo đơn. Về kỹ thuật,
 *   `processComment` cần danh tính JWT (spec §7.1) và hàm ở đây không nhận
 *   `prisma`/user thật — tạo đơn ảo sẽ phải mượn danh tính seed và ghi DB thật,
 *   làm bẩn số liệu demo/`/orders` của người dùng thật. Vì vậy chatter **không
 *   bao giờ** sinh đơn; `matches: []` (không qua parser) nên không highlight.
 *   Vài mẫu vẫn nhắc SKU + số lượng cho tự nhiên, nhưng ở dạng câu hỏi/trò
 *   chuyện — không phải cú pháp chốt đơn.
 * - **Nhịp tick 4–8s ngẫu nhiên** dùng `setTimeout` tự lên lịch lại (không phải
 *   `setInterval`) — mỗi tick: đổi số người xem (RAM) + phát `viewers` + một
 *   comment mẫu. `stop` clear timer đang chờ nên dừng là dừng hẳn.
 * - **Vòng đời `peak`**: `start` reset peak về 0; mỗi tick cập nhật
 *   `peak = max(peak, viewers)`; `stop` giữ peak đọc được qua
 *   `getFakeCommentPeak` (Task 11 lưu vào `LiveSession.peakViewers`).
 * - `start` **idempotent**: gọi lại khi đang chạy là no-op, không nhân đôi timer.
 */

/** Khoảng cách hai comment liên tiếp: 4–8 giây (randomInt max loại trừ). */
const TICK_MIN_MS = 4_000;
const TICK_MAX_MS = 8_000;

/** Người xem ảo: khởi điểm ngẫu nhiên, bước nhảy mỗi tick, biên dưới/trên. */
const VIEWERS_START_MIN = 25;
const VIEWERS_START_MAX = 45;
const VIEWERS_MIN = 8;
const VIEWERS_MAX = 160;
const VIEWERS_STEP_MIN = -6;
const VIEWERS_STEP_MAX = 8;

/** Một mẫu chat: `{shop}` được thay bằng tên shop khi phát. */
type FakeSample = {
  userId: string;
  userName: string;
  text: string;
};

/** Danh tính ảo không trùng id seed (uuid) — UI chỉ hiển thị `userName`. */
const FAKE_SAMPLES: readonly FakeSample[] = [
  { userId: "fake-huong", userName: "Hương", text: "{shop} ơi áo này còn size L không ạ?" },
  { userId: "fake-trang", userName: "Trang", text: "Mẫu SP01 nhìn đẹp quá shop ơi 😍" },
  { userId: "fake-dung", userName: "Dũng", text: "SP02 còn size M không shop?" },
  { userId: "fake-yen", userName: "Yến", text: "Cho mình hỏi SP06 bao giờ về hàng vậy ạ?" },
  { userId: "fake-nhung", userName: "Nhung", text: "Freeship đơn 300k đúng không shop?" },
  { userId: "fake-bao", userName: "Bảo", text: "SP03 lấy 2 cái giá bao nhiêu vậy shop?" },
  { userId: "fake-phuc", userName: "Phúc", text: "Mình ở Đà Nẵng thì bao lâu nhận được ạ?" },
  { userId: "fake-thao", userName: "Thảo", text: "Áo khoác gió này có màu đen không shop?" },
  { userId: "fake-kien", userName: "Kiên", text: "Đẹp quá, mình lấy 1 cái nha shop" },
  { userId: "fake-lan", userName: "Lan", text: "Vừa nhận hàng hôm qua, chất vải xịn lắm ❤️" },
  { userId: "fake-minhanh", userName: "Minh Anh", text: "Giá SP07 bao nhiêu vậy shop ơi?" },
  { userId: "fake-quan", userName: "Quân", text: "Shop có ship COD không ạ?" },
  { userId: "fake-hang", userName: "Hằng", text: "Áo thun basic 150k hả shop?" },
  { userId: "fake-my", userName: "My", text: "Xem mãi mới thấy live của shop 🥰" },
];

type FakeState = {
  /** Timer tick kế tiếp; `null` trong khoảnh khắc giữa hai tick hiếm hoi. */
  timer: NodeJS.Timeout | null;
  viewers: number;
  peak: number;
};

/** Phiên đang chạy giả lập. */
const running = new Map<string, FakeState>();

/** Peak của phiên đã stop (giữ đọc được — hợp đồng `getFakeCommentPeak`). */
const archivedPeaks = new Map<string, number>();

function buildFakeComment(shopName: string): CommentEvent {
  const sample = FAKE_SAMPLES[randomInt(FAKE_SAMPLES.length)];
  return {
    userId: sample.userId,
    userName: sample.userName,
    text: sample.text.replaceAll("{shop}", shopName),
    matches: [],
    kind: "user",
    createdAt: new Date().toISOString(),
  };
}

function clampViewers(value: number): number {
  return Math.min(Math.max(value, VIEWERS_MIN), VIEWERS_MAX);
}

/** Lên lịch tick kế tiếp (4–8s). Tự dừng nếu phiên đã bị stop/khởi động lại. */
function scheduleTick(
  io: Server,
  sessionId: string,
  shopName: string,
  state: FakeState,
): NodeJS.Timeout {
  const delay = randomInt(TICK_MIN_MS, TICK_MAX_MS + 1);
  return setTimeout(() => {
    // Đã stop (map xoá) hoặc đã start lại (state mới) → tick cũ tự huỷ.
    if (running.get(sessionId) !== state) {
      return;
    }

    state.viewers = clampViewers(
      state.viewers + randomInt(VIEWERS_STEP_MIN, VIEWERS_STEP_MAX + 1),
    );
    state.peak = Math.max(state.peak, state.viewers);
    archivedPeaks.set(sessionId, state.peak);

    const nsp = io.of(LIVE_NAMESPACE);
    nsp.to(liveRoom(sessionId)).emit("viewers", {
      count: state.viewers,
    } satisfies ViewersEvent);
    nsp.to(liveRoom(sessionId)).emit("comment", buildFakeComment(shopName));

    state.timer = scheduleTick(io, sessionId, shopName, state);
  }, delay);
}

/**
 * Bật giả lập cho một phiên. No-op khi `DEMO_MODE !== 'true'` hoặc khi phiên
 * đang chạy (idempotent). Phát luôn `viewers` đầu tiên để badge 👀 có số ngay.
 */
export function startFakeComments(
  io: Server,
  sessionId: string,
  shopName: string,
): void {
  if (process.env.DEMO_MODE !== "true") {
    return;
  }
  if (running.has(sessionId)) {
    return;
  }

  const state: FakeState = {
    timer: null,
    viewers: randomInt(VIEWERS_START_MIN, VIEWERS_START_MAX + 1),
    peak: 0,
  };
  running.set(sessionId, state);
  archivedPeaks.set(sessionId, 0); // start reset peak

  io.of(LIVE_NAMESPACE).to(liveRoom(sessionId)).emit("viewers", {
    count: state.viewers,
  } satisfies ViewersEvent);

  state.timer = scheduleTick(io, sessionId, shopName, state);
}

/** Tắt giả lập. Không có gì đang chạy → no-op; peak giữ lại cho Task 11 đọc. */
export function stopFakeComments(sessionId: string): void {
  const state = running.get(sessionId);
  if (state === undefined) {
    return;
  }
  if (state.timer !== null) {
    clearTimeout(state.timer);
  }
  archivedPeaks.set(sessionId, state.peak);
  running.delete(sessionId);
}

/** Phiên đang chạy giả lập? (test Task 10 case 7 + nút UI Studio). */
export function isFakeCommentsRunning(sessionId: string): boolean {
  return running.has(sessionId);
}

/**
 * Peak người xem ảo: số đang sống khi phiên đang chạy, số lưu lại sau khi stop,
 * `0` nếu phiên chưa từng chạy giả lập. `start` reset về 0.
 */
export function getFakeCommentPeak(sessionId: string): number {
  const state = running.get(sessionId);
  if (state !== undefined) {
    return state.peak;
  }
  return archivedPeaks.get(sessionId) ?? 0;
}
