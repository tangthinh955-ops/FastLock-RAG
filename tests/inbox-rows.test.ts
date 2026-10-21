import { describe, expect, it } from "vitest";
import { mergeInboxRows, type InboxRowLike } from "../lib/chat/inbox-rows";

/**
 * Unit test cho phép hợp nhất danh sách hội thoại seller giữa payload RSC và
 * state realtime — hàm thuần, không cần DOM/DB.
 */

type Row = InboxRowLike & {
  mode: "AI" | "HUMAN";
  lastMessage: { content: string } | null;
};

function row(
  id: string,
  activityAt: string,
  mode: Row["mode"] = "AI",
  content: string | null = null,
): Row {
  return { id, activityAt, mode, lastMessage: content === null ? null : { content } };
}

describe("chat/inbox-rows — mergeInboxRows", () => {
  it("server có dòng mới → thêm; state rỗng → lấy nguyên payload server", () => {
    const server = [row("a", "2026-10-21T10:00:00.000Z"), row("b", "2026-10-21T09:00:00.000Z")];
    const merged = mergeInboxRows(server, [row("a", "2026-10-21T08:00:00.000Z")]);

    expect(merged.map((item) => item.id)).toEqual(["a", "b"]);
    expect(merged[0]).toEqual(server[0]); // server mới hơn → server thắng

    const fromEmpty = mergeInboxRows(server, []);
    expect(fromEmpty).toEqual(server);
    expect(fromEmpty).not.toBe(server); // không trả chính mảng prop
  });

  it("payload RSC cũ hơn → giữ dòng realtime (không kéo lùi lastMessage/mode)", () => {
    const server = [
      row("a", "2026-10-21T09:00:00.000Z", "AI", "tin cũ"),
    ];
    const current = [
      row("a", "2026-10-21T10:00:00.000Z", "HUMAN", "tin mới realtime"),
    ];

    const merged = mergeInboxRows(server, current);

    expect(merged).toEqual(current);
  });

  it("server mới hơn hoặc bằng → server thắng (nguồn sự thật)", () => {
    const server = [row("a", "2026-10-21T10:00:00.000Z", "HUMAN", "server")];
    const older = [row("a", "2026-10-21T09:00:00.000Z", "AI", "client cũ")];
    expect(mergeInboxRows(server, older)).toEqual(server);

    const equal = [row("a", "2026-10-21T10:00:00.000Z", "AI", "client bằng mốc")];
    expect(mergeInboxRows(server, equal)).toEqual(server);
  });

  it("dòng chỉ có ở client (realtime mới hơn payload) vẫn được giữ", () => {
    const server = [row("a", "2026-10-21T09:00:00.000Z")];
    const current = [
      row("a", "2026-10-21T09:00:00.000Z"),
      row("moi", "2026-10-21T10:00:00.000Z", "AI", "hội thoại mới"),
    ];

    const merged = mergeInboxRows(server, current);

    expect(merged.map((item) => item.id)).toEqual(["a", "moi"]);
    expect(merged[1].lastMessage).toEqual({ content: "hội thoại mới" });
  });
});
