import { describe, expect, it } from "vitest";
import { formatWhen, previewText } from "../lib/chat/format";

/**
 * Unit test cho helper định dạng dùng chung của hai danh sách hội thoại —
 * output phía buyer phải GIỮ NGUYÊN như bản copy cũ trong `InboxClient`.
 */
describe("chat/format — formatWhen + previewText", () => {
  it("formatWhen: hôm nay → HH:mm; ngày cũ → kèm ngày/tháng; ISO hỏng → rỗng", () => {
    expect(formatWhen(new Date().toISOString())).toMatch(/^\d{2}:\d{2}$/);

    // Máy chủ Node dùng ICU vi-VN xếp giờ trước ngày ("10:04 02-01"), nên chỉ
    // khẳng định nhánh "khác ngày" thêm phần ngày/tháng — không ghim thứ tự
    // chuỗi (output cũ của hai component cũng do cùng Intl này sinh ra).
    const older = formatWhen("2020-01-02T03:04:00.000Z");
    expect(older).not.toMatch(/^\d{2}:\d{2}$/);
    expect(older).toMatch(/\d{2}[-/]\d{2}/);

    expect(formatWhen("không-phải-ngày")).toBe("");
  });

  it("previewText phía buyer giữ nguyên output cũ", () => {
    expect(previewText(null, "buyer")).toBe(
      "Chưa có tin nhắn — bắt đầu trò chuyện nhé",
    );
    expect(previewText({ source: "BUYER", content: "  Chào   shop " }, "buyer")).toBe(
      "Bạn: Chào shop",
    );
    expect(previewText({ source: "SELLER", content: "Dạ" }, "buyer")).toBe(
      "Nhân viên shop: Dạ",
    );
    expect(previewText({ source: "AI", content: "Mình tư vấn nhé" }, "buyer")).toBe(
      "Mình tư vấn nhé",
    );
    expect(previewText({ source: "SYSTEM", content: "Đã tạo đơn #2" }, "buyer")).toBe(
      "Đã tạo đơn #2",
    );
  });

  it("previewText phía seller: khách → 'Khách:', mình → 'Bạn:'", () => {
    expect(previewText(null, "seller")).toBe(
      "Chưa có tin nhắn — khách chưa nhắn gì",
    );
    expect(previewText({ source: "BUYER", content: " Còn hàng không " }, "seller")).toBe(
      "Khách: Còn hàng không",
    );
    expect(previewText({ source: "SELLER", content: "Còn nhé" }, "seller")).toBe(
      "Bạn: Còn nhé",
    );
    expect(previewText({ source: "AI", content: "Dạ còn" }, "seller")).toBe("Dạ còn");
    expect(previewText({ source: "SYSTEM", content: "Nhắc thanh toán" }, "seller")).toBe(
      "Nhắc thanh toán",
    );
  });
});
