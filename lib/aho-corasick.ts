/**
 * Aho-Corasick bắt mã SKU trong comment livestream (spec §4, §7.7) — lõi của
 * tính năng ①: comment → SKU → tạo đơn.
 *
 * Quy tắc (theo brief Task 8):
 * - So khớp KHÔNG phân biệt hoa/thường.
 * - Ranh giới từ: ký tự ngay trước `start` và ngay sau `end` không được thuộc
 *   `[A-Z0-9_]` (không phân biệt hoa thường) — nên `SP01` không khớp trong
 *   `xSP01`, `SP010`, `SP01_x`, và `SP01SP02` không khớp mã nào.
 * - Mỗi vị trí bắt đầu chỉ trả match DÀI NHẤT: có cả `SP01` lẫn `SP010` thì
 *   `SP010` thắng `SP01`, không trả trùng bản ngắn.
 * - `start`/`end` là chỉ số UTF-16 trên CHÍNH chuỗi truyền vào `findMatches`
 *   (`end` mở) để Task 9/13 cắt chuỗi highlight không lệch.
 *
 * Dùng ở Task 9 (pipeline comment → đơn) và Task 13 (highlight UI):
 *   const automaton = buildAutomaton(products.map((p) => p.sku));
 *   const { matches, elapsedMs } = findMatchesWithTiming(automaton, comment);
 */

/** Một lần bắt được SKU: vị trí UTF-16 `[start, end)` trong text đưa vào tìm. */
export type Match = { sku: string; start: number; end: number };

type TrieNode = {
  /** Con theo ký tự đã chuẩn hóa hoa — mỗi code unit của pattern là 1 bước đi. */
  children: Map<string, TrieNode>;
  /** Hậu tố dài nhất của tiền tố dẫn tới nút này cũng là tiền tố của pattern. */
  fail: TrieNode | null;
  /** SKU (nguyên bản lúc build) kết thúc tại nút này hoặc ở tổ tiên fail của nó. */
  outputs: string[];
};

/**
 * Automaton đóng băng sau khi build: `findMatches` không sửa automaton nên
 * một automaton dùng chung an toàn cho mọi comment (Task 9 giữ nó theo phiên live).
 */
export type Automaton = {
  root: TrieNode;
  /** Số pattern thật sự được nạp (đã bỏ chuỗi rỗng và bản trùng nhau). */
  patternCount: number;
};

/** Ký tự "dính" token — đúng tập hợp brief: `[A-Z0-9_]`, `i` cho hoa/thường. */
const WORD_CHAR = /[A-Z0-9_]/i;

function isWordChar(ch: string | undefined): boolean {
  return ch !== undefined && WORD_CHAR.test(ch);
}

function createNode(): TrieNode {
  return { children: new Map(), fail: null, outputs: [] };
}

/**
 * Chuẩn hóa MỘT code unit về chữ hoa. Không dùng `text.toUpperCase()` cho cả
 * chuỗi vì vài ký tự đổi độ dài khi viết hoa (ví dụ 'ß' → 'SS') làm lệch chỉ
 * số UTF-16 trả về. Chuẩn hóa từng code unit ở cả pattern lẫn text thì `start`/
 * `end` luôn trỏ đúng chuỗi gốc; khóa có thể dài hơn 1 ký tự ('ß' → 'SS')
 * nhưng vẫn tương ứng đúng 1 code unit.
 */
function upperCodeUnit(ch: string): string {
  return ch.toUpperCase();
}

/**
 * Dựng trie từ danh sách SKU rồi nối fail link kiểu BFS. SKU rỗng bị bỏ (match
 * dài 0 vô nghĩa); SKU trùng nhau sau chuẩn hóa hoa/thường giữ bản xuất hiện
 * đầu tiên — chuỗi `sku` trả về giữ nguyên chữ như lúc build.
 */
export function buildAutomaton(skus: string[]): Automaton {
  const root = createNode();
  const seen = new Set<string>();
  let patternCount = 0;

  for (const sku of skus) {
    if (sku.length === 0) continue;

    const keys: string[] = [];
    for (let i = 0; i < sku.length; i += 1) {
      keys.push(upperCodeUnit(sku[i]));
    }
    // JSON.stringify để hai pattern khác nhau không bao giờ trùng khóa ghép
    // (ví dụ 'AB'+'C' khác 'A'+'BC').
    const dedupeKey = JSON.stringify(keys);
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    let node = root;
    for (const key of keys) {
      let next = node.children.get(key);
      if (next === undefined) {
        next = createNode();
        node.children.set(key, next);
      }
      node = next;
    }
    node.outputs.push(sku);
    patternCount += 1;
  }

  // BFS: con trực tiếp của gốc có fail = gốc; mỗi nút con thừa hưởng output
  // của fail link (đã lan truyền trước vì fail luôn nông hơn).
  const queue: TrieNode[] = [];
  for (const child of root.children.values()) {
    child.fail = root;
    queue.push(child);
  }

  for (let qi = 0; qi < queue.length; qi += 1) {
    const node = queue[qi];

    if (node.fail !== null && node.fail.outputs.length > 0) {
      node.outputs.push(...node.fail.outputs);
    }

    for (const [key, child] of node.children) {
      let candidate = node.fail;
      while (candidate !== null && !candidate.children.has(key)) {
        candidate = candidate.fail;
      }
      child.fail = candidate?.children.get(key) ?? root;
      queue.push(child);
    }
  }

  return { root, patternCount };
}

/**
 * Quét text một lượt qua automaton, trả các match đã qua kiểm tra ranh giới từ,
 * sắp theo `start` tăng dần. Hàm thuần với automaton — gọi lại nhiều lần, nhiều
 * text khác nhau đều được.
 */
export function findMatches(automaton: Automaton, text: string): Match[] {
  const { root } = automaton;
  // Gộp theo vị trí bắt đầu: giữ match dài nhất (end lớn nhất) tại mỗi vị trí.
  const bestByStart = new Map<number, Match>();

  let state = root;
  for (let i = 0; i < text.length; i += 1) {
    const key = upperCodeUnit(text[i]);

    while (state !== root && !state.children.has(key)) {
      state = state.fail ?? root;
    }
    state = state.children.get(key) ?? root;

    for (const sku of state.outputs) {
      const start = i + 1 - sku.length;
      const end = i + 1;
      // Ranh giới: ký tự trước `start` và sau `end` không được là ký tự từ.
      if (isWordChar(text[start - 1]) || isWordChar(text[end])) continue;

      const current = bestByStart.get(start);
      if (current === undefined || current.end < end) {
        bestByStart.set(start, { sku, start, end });
      }
    }
  }

  return [...bestByStart.values()].sort((a, b) => a.start - b.start);
}

/**
 * Như `findMatches` nhưng đo thời gian chạy THẬT bằng `performance.now()` để
 * hiển thị trên UI (spec §13.4: "0,4 ms" phải là số đo thật, không hard-code).
 * Giá trị trả về là số thô — không làm tròn, không kẹp sàn.
 */
export function findMatchesWithTiming(
  automaton: Automaton,
  text: string,
): { matches: Match[]; elapsedMs: number } {
  const startedAt = performance.now();
  const matches = findMatches(automaton, text);
  const elapsedMs = performance.now() - startedAt;
  return { matches, elapsedMs };
}
