import { describe, expect, it } from "vitest";
import {
  buildAutomaton,
  findMatches,
  findMatchesWithTiming,
  type Match,
} from "../lib/aho-corasick";

// Ca nghiệm thu nguyên văn theo brief Task 8 — vị trí `start`/`end` là chỉ số
// UTF-16 trên CHÍNH chuỗi đưa vào tìm (end mở), để Task 9/13 cắt chuỗi highlight.
// Với chuỗi có dấu tiếng Việt, test luôn tự tính vị trí bằng `indexOf` (không
// đếm tay) trừ ca cơ bản brief đã cho số cụ thể.

describe("aho-corasick — bắt SKU theo ranh giới từ (brief Task 8)", () => {
  it("cơ bản: 'mình lấy SP01 2 cái' → 1 match { sku: 'SP01', start: 9, end: 13 }", () => {
    const text = "mình lấy SP01 2 cái";
    expect(findMatches(buildAutomaton(["SP01"]), text)).toEqual([
      { sku: "SP01", start: 9, end: 13 },
    ]);
  });

  it("ranh giới từ: 'SP010 size L' với [SP01, SP010] → chỉ match SP010 (dài nhất)", () => {
    const text = "SP010 size L";
    const at = text.indexOf("SP010");
    expect(findMatches(buildAutomaton(["SP01", "SP010"]), text)).toEqual([
      { sku: "SP010", start: at, end: at + 5 },
    ]);
  });

  it("ranh giới từ: 'xSP01' → không match (ký tự trước là chữ)", () => {
    expect(findMatches(buildAutomaton(["SP01"]), "xSP01")).toEqual([]);
  });

  it("hoa thường: 'sp01 còn không' → match SP01 (so không phân biệt hoa/thường)", () => {
    const text = "sp01 còn không";
    expect(findMatches(buildAutomaton(["SP01"]), text)).toEqual([
      { sku: "SP01", start: 0, end: 4 },
    ]);
  });

  it("nhiều match: 'SP01 và SP03' → 2 matches đúng thứ tự, đúng vị trí", () => {
    const text = "SP01 và SP03";
    const first = text.indexOf("SP01");
    const second = text.indexOf("SP03");
    expect(findMatches(buildAutomaton(["SP01", "SP03"]), text)).toEqual([
      { sku: "SP01", start: first, end: first + 4 },
      { sku: "SP03", start: second, end: second + 4 },
    ]);
  });

  it("Unicode quanh: 'áo đẹp quá SP02 nha' → vị trí đúng theo index UTF-16", () => {
    const text = "áo đẹp quá SP02 nha";
    const at = text.indexOf("SP02");
    expect(findMatches(buildAutomaton(["SP02"]), text)).toEqual([
      { sku: "SP02", start: at, end: at + 4 },
    ]);
  });

  it("danh sách SKU rỗng / text rỗng → []", () => {
    expect(findMatches(buildAutomaton([]), "SP01")).toEqual([]);
    expect(findMatches(buildAutomaton(["SP01"]), "")).toEqual([]);
  });

  it("SKU rỗng trong danh sách bị bỏ qua, không tạo match độ dài 0", () => {
    const automaton = buildAutomaton(["", "SP01"]);
    expect(findMatches(automaton, "SP01")).toEqual([
      { sku: "SP01", start: 0, end: 4 },
    ]);
  });

  it("một vị trí bắt đầu chỉ trả match DÀI NHẤT: pattern chồng tiền tố [SP, SP01] trong 'SP01'", () => {
    expect(findMatches(buildAutomaton(["SP", "SP01"]), "SP01")).toEqual([
      { sku: "SP01", start: 0, end: 4 },
    ]);
  });

  it("match dài hơn hỏng ranh giới không 'che' match ngắn hợp lệ cùng vị trí bắt đầu", () => {
    // 'A--' tại vị trí 0 bị chặn vì sau nó là 'X' (ký tự từ), còn 'A-' hợp lệ
    // (sau nó là '-') — vị trí 0 vẫn trả match dài nhất TRONG CÁC match hợp lệ.
    expect(findMatches(buildAutomaton(["A-", "A--"]), "A--X")).toEqual([
      { sku: "A-", start: 0, end: 2 },
    ]);
  });

  it("hai match cùng vị trí bắt đầu đều HỢP LỆ ranh giới → chỉ trả match dài nhất", () => {
    // Khác test trên đúng ký tự cuối: 'A-- ' cho CẢ 'A-' lẫn 'A--' qua ranh
    // giới, nên vị trí 0 phải trả 'A--' (dài nhất) — dedupe kiểu "giữ bản gặp
    // trước" sẽ trả nhầm 'A-' vì 'A-' kết thúc sớm hơn.
    expect(findMatches(buildAutomaton(["A-", "A--"]), "A-- ")).toEqual([
      { sku: "A--", start: 0, end: 3 },
    ]);
  });

  it("cùng vị trí bắt đầu, bản dài hợp lệ: ['SP01', 'SP01-X'] trên 'mua SP01-X nha' → chỉ SP01-X", () => {
    const text = "mua SP01-X nha";
    const at = text.indexOf("SP01-X");
    // 'SP01' tại 4 cũng hợp lệ (sau nó là '-'), nhưng vị trí 4 chỉ được trả
    // match dài nhất: 'SP01-X'.
    expect(findMatches(buildAutomaton(["SP01", "SP01-X"]), text)).toEqual([
      { sku: "SP01-X", start: at, end: at + 6 },
    ]);
  });

  it("index UTF-16 giữ đúng chuỗi gốc dù viết hoa cả chuỗi sẽ đổi độ dài ('ß' → 'SS')", () => {
    const text = "ß mua SP01 nha";
    const at = text.indexOf("SP01");
    expect(findMatches(buildAutomaton(["SP01"]), text)).toEqual([
      { sku: "SP01", start: at, end: at + 4 },
    ]);
  });

  it("lồng ba tầng [SP1, SP10, SP010]: text dài nào thắng ở vị trí 0 cũng đúng", () => {
    const automaton = buildAutomaton(["SP1", "SP10", "SP010"]);
    expect(findMatches(automaton, "SP010")).toEqual([
      { sku: "SP010", start: 0, end: 5 },
    ]);
    expect(findMatches(automaton, "SP10")).toEqual([
      { sku: "SP10", start: 0, end: 4 },
    ]);
    // Không còn bản dài hơn trong text thì bản ngắn nhất vẫn bắt đúng.
    expect(findMatches(automaton, "SP1")).toEqual([
      { sku: "SP1", start: 0, end: 3 },
    ]);
  });

  it("output theo fail-chain: pattern là ĐUÔI của pattern dài hơn vẫn được bắt", () => {
    // Khi chạy hết 'A.-1', match '-1' chỉ đến được qua fail link (nút 'A.-1'
    // có hậu tố '-1' là một nút của trie). Ranh giới của '-1' là dấu '.'
    // (không phải ký tự từ) nên cả hai match đều hợp lệ, xếp theo vị trí.
    expect(findMatches(buildAutomaton(["A.-1", "-1"]), "A.-1")).toEqual([
      { sku: "A.-1", start: 0, end: 4 },
      { sku: "-1", start: 2, end: 4 },
    ]);
  });

  it("ranh giới '_' (ký tự từ): 'SP01_x', '_SP01', 'SP01_' → không match", () => {
    const automaton = buildAutomaton(["SP01"]);
    expect(findMatches(automaton, "SP01_x")).toEqual([]);
    expect(findMatches(automaton, "_SP01")).toEqual([]);
    expect(findMatches(automaton, "SP01_")).toEqual([]);
  });

  it("chữ/số ASCII dính token: 'muaSP01' và '1SP01' → không match", () => {
    const automaton = buildAutomaton(["SP01"]);
    expect(findMatches(automaton, "muaSP01")).toEqual([]);
    expect(findMatches(automaton, "1SP01")).toEqual([]);
  });

  it("quy tắc ranh giới literal [A-Z0-9_] của brief: chữ ngoài ASCII như 'á' không dính token", () => {
    // Brief ghi rõ ranh giới là [A-Z0-9_] (không phân biệt hoa thường) — chữ cái
    // có dấu tiếng Việt KHÔNG thuộc tập này, nên 'áSP01' vẫn bắt được SP01.
    const text = "áSP01";
    const at = text.indexOf("SP01");
    expect(findMatches(buildAutomaton(["SP01"]), text)).toEqual([
      { sku: "SP01", start: at, end: at + 4 },
    ]);
  });

  it("dấu câu quanh SKU là ranh giới hợp lệ: 'chốt (SP01), SP02!' → cả hai", () => {
    const text = "chốt (SP01), SP02!";
    const first = text.indexOf("SP01");
    const second = text.indexOf("SP02");
    expect(findMatches(buildAutomaton(["SP01", "SP02"]), text)).toEqual([
      { sku: "SP01", start: first, end: first + 4 },
      { sku: "SP02", start: second, end: second + 4 },
    ]);
  });

  it("hai SKU sát nhau cách một dấu cách: 'SP01 SP02' → 2 match", () => {
    expect(findMatches(buildAutomaton(["SP01", "SP02"]), "SP01 SP02")).toEqual(
      [
        { sku: "SP01", start: 0, end: 4 },
        { sku: "SP02", start: 5, end: 9 },
      ],
    );
  });

  it("hai SKU dính liền không dấu cách: 'SP01SP02' → không match mã nào", () => {
    expect(findMatches(buildAutomaton(["SP01", "SP02"]), "SP01SP02")).toEqual(
      [],
    );
  });

  it("trùng SKU trong danh sách (kể cả khác hoa thường) → chỉ 1 match, giữ chữ lần đầu", () => {
    const automaton = buildAutomaton(["SP01", "SP01", "sp01"]);
    expect(findMatches(automaton, "sp01")).toEqual([
      { sku: "SP01", start: 0, end: 4 },
    ]);
  });

  it("patternCount đếm số pattern nạp thật (bỏ chuỗi rỗng, bỏ bản trùng)", () => {
    expect(buildAutomaton([]).patternCount).toBe(0);
    expect(
      buildAutomaton(["", "SP01", "SP01", "sp01", "SP02"]).patternCount,
    ).toBe(2);
  });

  it("SKU đưa vào chữ thường vẫn khớp; `sku` trả về giữ nguyên chữ như lúc build", () => {
    const text = "MUA SP01 NHA";
    const at = text.indexOf("SP01");
    const matches: Match[] = findMatches(buildAutomaton(["sp01"]), text);
    expect(matches).toEqual([{ sku: "sp01", start: at, end: at + 4 }]);
  });

  it("SKU chứa ký tự đặc biệt của regex vẫn so khớp chuỗi thường: 'A+B'", () => {
    const text = "mua A+B nha";
    const at = text.indexOf("A+B");
    expect(findMatches(buildAutomaton(["A+B"]), text)).toEqual([
      { sku: "A+B", start: at, end: at + 3 },
    ]);
  });

  it("automaton dùng lại được nhiều lần, không dính state giữa các lần tìm", () => {
    const automaton = buildAutomaton(["SP01"]);
    expect(findMatches(automaton, "SP01")).toEqual([
      { sku: "SP01", start: 0, end: 4 },
    ]);
    expect(findMatches(automaton, "xSP01")).toEqual([]);
    expect(findMatches(automaton, "SP01")).toEqual([
      { sku: "SP01", start: 0, end: 4 },
    ]);
  });
});

describe("findMatchesWithTiming — đo thời gian THẬT (spec §13.4)", () => {
  it("matches y hệt findMatches; elapsedMs là số thực hữu hạn ≥ 0", () => {
    const automaton = buildAutomaton(["SP01", "SP03"]);
    const text = "mình lấy SP01 và SP03 nha";
    const timed = findMatchesWithTiming(automaton, text);
    expect(timed.matches).toEqual(findMatches(automaton, text));
    expect(typeof timed.elapsedMs).toBe("number");
    expect(Number.isFinite(timed.elapsedMs)).toBe(true);
    expect(timed.elapsedMs).toBeGreaterThanOrEqual(0);
  });

  it("text rỗng → matches [], elapsedMs vẫn là số hợp lệ", () => {
    const timed = findMatchesWithTiming(buildAutomaton(["SP01"]), "");
    expect(timed.matches).toEqual([]);
    expect(Number.isFinite(timed.elapsedMs)).toBe(true);
    expect(timed.elapsedMs).toBeGreaterThanOrEqual(0);
  });

  it("khối lượng lớn (200 SKU × ~240k ký tự) → đủ 40.000 match và elapsedMs > 0 (không hard-code/clamp)", () => {
    const skus = Array.from(
      { length: 200 },
      (_, i) => `SP${String(i + 1).padStart(3, "0")}`,
    );
    const automaton = buildAutomaton(skus);
    const text = `${skus.join(" ")} `.repeat(200);
    const timed = findMatchesWithTiming(automaton, text);
    expect(timed.matches).toHaveLength(40_000);
    expect(timed.elapsedMs).toBeGreaterThan(0);
  });
});
