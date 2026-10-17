# LiveOrder — demo livestream bán hàng

Ứng dụng demo bán hàng qua livestream (đồ án tốt nghiệp). Người bán lên sóng, người mua xem và chốt đơn ngay trong bình luận.

> **Lưu ý version:** plan gốc ghi Next.js 15, nhưng `create-next-app@latest` tại thời điểm khởi tạo cài **Next.js 16.4.2** (React 19.3, Tailwind CSS v4). Đây là deviation đã được chấp nhận.

## Bắt đầu

1. `npm install`
2. Copy `.env.example` → `.env` và điền giá trị trước khi chạy (`copy .env.example .env` trên Windows / `cp .env.example .env` trên Git Bash).
3. `npm run dev` → mở http://localhost:3000
4. Test: `npm test` (chạy một lần) hoặc `npm run test:watch`.

## Biến môi trường

Xem `.env.example` — các key: `DATABASE_URL`, `TEST_DATABASE_URL`, `JWT_SECRET`, `DEMO_MODE`, `GROQ_API_KEY` (để trống cho Plan 2), `PORT`. File `.env` không được commit.

## Trạng thái

- [x] Task 1: scaffold Next.js + Tailwind + Vitest (trang chủ tạm tiếng Việt)

README này sẽ được hoàn thiện ở Task 12 (cách chạy đầy đủ, tài khoản demo, luồng 2 cửa sổ).
