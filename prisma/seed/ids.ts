/**
 * UUID cố định (v4, viết cứng) cho toàn bộ dữ liệu seed nền.
 *
 * Vì sao viết cứng: re-seed không được gãy quan hệ giữa các bảng, và mọi task
 * sau (live session, đơn hàng, hội thoại, RAG…) có thể trỏ thẳng vào id ổn
 * định thay vì tra cứu theo email/sku lúc runtime (spec §6: "Seed dùng UUID cố
 * định (hằng số) để re-seed không gãy quan hệ").
 *
 * Đừng đổi các giá trị này — lịch sử seed ở Task 4 và test của các task sau
 * đều dựa vào chúng.
 */
export const SEED_IDS = {
  users: {
    khach: "a70ec0a1-2f19-45c1-87e3-6197e5f93f49",
    hong: "f9261f42-dd73-46c8-bb30-64a34ba20aca",
    minh: "b333cdb3-3571-4d92-994d-c839dc6e1a8f",
    linh: "560a9b2b-cb49-4375-937f-2292eaa80a87",
    baoan: "d1fe04ad-be65-4689-96c7-b10d30178373",
  },
  shops: {
    linh: "3b60c362-95ba-4091-ae26-fe146815575e",
    baoan: "736bdd4d-1a5d-4dc9-a579-da2eb58f1449",
  },
  products: {
    linh_sp01: "9fde557e-5c55-4f7a-a0e3-03323dbed252",
    linh_sp02: "8167adc4-209c-42e1-89f5-708cf4805586",
    linh_sp03: "e885b1c0-4a92-4d5a-a629-ed06b57b6484",
    linh_sp04: "ae783d8c-b938-4908-9333-b29b5a2104cd",
    linh_sp05: "5dbb5828-560b-4ad2-a18d-96c432766635",
    linh_sp06: "01b5d741-788d-4776-a7ed-d54ad3e6448a",
    linh_sp07: "adb80a7f-7cfa-4bae-9c98-0e6201db8526",
    baoan_sp01: "60c74a30-4e02-4442-aacf-9bfcff9d2ca6",
    baoan_sp02: "b13c2d5a-6402-49a6-b4f9-06ed925c1ffa",
    baoan_sp03: "3e8f939c-922e-4a2b-a3f2-88cf53ff5922",
  },
  kb: {
    linh_size: "15794153-32db-4136-b7f8-faf5dcb0d131",
    linh_return: "fbaa6699-7486-48ad-adac-3b5bee29f3f8",
    linh_defect: "f9c4f15c-8514-4731-9123-d3ea1aaa9f08",
    linh_ship: "f79dda82-b235-40ac-aae6-c7a1dfb148ab",
    linh_live_order: "4fe56310-b189-4bfb-b25f-f0d43d152ec9",
    linh_promo: "d38cfcf1-f366-493b-af9e-016ac5922c4a",
    baoan_size: "bf102eb5-e115-4d11-8929-f01f4ad3e64f",
    baoan_return: "842ce93d-8d27-4b0a-a65f-929cd15b5b3d",
    baoan_ship: "2e17ce0f-bbbd-4c78-a609-302064617410",
  },
} as const;
