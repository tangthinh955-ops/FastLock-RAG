import { describe, expect, it } from "vitest";
import { maskPhones } from "../lib/mask";

describe("maskPhones — che SĐT di động VN trước khi broadcast (spec §7.2)", () => {
  // 5 ca nghiệm thu nguyên văn theo brief Task 7.
  it("số liền một mạch: chỉ thay đúng dãy số giữa hai bên là chữ", () => {
    expect(maskPhones("gọi 0912345678 nhé")).toBe("gọi 0912***678 nhé");
  });

  it("nhóm bằng dấu cách (4-3-3): nuốt luôn dấu cách nằm trong span", () => {
    expect(maskPhones("sđt: 0912 345 678")).toBe("sđt: 0912***678");
  });

  it("quy +84 về 0 trước khi mask", () => {
    expect(maskPhones("+84912345678 ship nhé")).toBe("0912***678 ship nhé");
  });

  it("che nhiều số trong một câu, kể cả dạng phân cách bằng dấu chấm", () => {
    expect(maskPhones("0912.345.678 và 0987654321")).toBe(
      "0912***678 và 0987***321",
    );
  });

  it("không phải SĐT (7 chữ số) → giữ nguyên", () => {
    expect(maskPhones("giá 1500000đ")).toBe("giá 1500000đ");
  });

  // Biến thể & ranh giới số — pin trực tiếp các quyết định ở Step 2 của brief.
  it("+84 viết rời bằng dấu cách → vẫn che cả nhóm", () => {
    expect(maskPhones("+84 912 345 678")).toBe("0912***678");
  });

  it("nhóm bằng dấu gạch → vẫn che", () => {
    expect(maskPhones("gọi 0912-345-678")).toBe("gọi 0912***678");
  });

  it("nhóm kiểu 3-3-4 / 2-4-4 (dấu cách giữa các nhóm bất kỳ) → vẫn che", () => {
    expect(maskPhones("gọi 091 234 5678 nha")).toBe("gọi 0912***678 nha");
    expect(maskPhones("sđt 03 1234 5678")).toBe("sđt 0312***678");
  });

  it("ranh giới số: mã 15 chữ số chứa tiền tố 09 ở đầu → giữ nguyên, không cắt giữa", () => {
    expect(maskPhones("mã vận đơn 091234567890123")).toBe(
      "mã vận đơn 091234567890123",
    );
  });

  it("ranh giới số: 11 chữ số đúng tiền tố nhưng thừa 1 số → giữ nguyên", () => {
    expect(maskPhones("09876543210")).toBe("09876543210");
  });

  it("ranh giới số: nhóm 4-3-4 (11 chữ số) → giữ nguyên, không cắt 10 số đầu", () => {
    expect(maskPhones("0912 345 6789")).toBe("0912 345 6789");
  });

  it("hai SĐT cách nhau đúng một dấu cách → che cả hai", () => {
    expect(maskPhones("0912345678 0987654321")).toBe("0912***678 0987***321");
  });
});
