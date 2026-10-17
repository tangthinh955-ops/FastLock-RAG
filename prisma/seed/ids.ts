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
  /**
   * Lịch sử demo (Task 4): hội thoại trong đêm, phiên live cũ, đơn cũ.
   * Hội thoại/phiên/đơn/tin nhắn đều upsert theo id cố định ở đây → re-seed
   * không nhân đôi và test/Dashboard trỏ thẳng tới được.
   */
  history: {
    conversations: {
      /** Khách↔Linh — tư vấn size ban đêm (23:10 → AI 00:12). */
      khach_linh: "2bf2f99a-1630-4b50-b9a6-1b94d8713903",
      /** Hồng↔Linh — đổi trả, kết thúc bằng seller tiếp quản (HUMAN). */
      hong_linh: "93167b47-c428-4f6f-aab8-21b24e99943a",
      /** Minh↔Linh — tra đơn sau live, hỏi lúc 23:10. */
      minh_linh: "38f42d42-f31f-4c2c-8189-9bf5dc3563d3",
      /** Khách↔Bảo An — chống lẫn shop: SP01 giá 200.000đ. */
      khach_baoan: "03cdca1b-ef95-4b37-96ee-8f8606df0255",
      /** Hồng↔Bảo An — phí ship riêng, không freeship. */
      hong_baoan: "2f4d8049-b93d-44a4-8587-ca3719c875f8",
    },
    sessions: {
      /** Live tối hôm qua 20:00–22:05 (đơn H1/H2/H3 thuộc phiên này). */
      linh_yesterday: "0fc24127-b72c-4aac-b0ae-7202ad2e29ac",
      /** Live cách đây 7 ngày 20:00–22:05 (đơn H4/H5 thuộc phiên này). */
      linh_week_ago: "35a6ad61-8dcf-422d-b8b6-a39753dcb97d",
    },
    orders: {
      /** H1 — SP01 ×2 = 300.000đ PAID (hôm qua). */
      h1: "537c3e2c-0868-4e49-b928-0f2a0d0863f3",
      /** H2 — SP02 ×2 = 440.000đ PAID (hôm qua). */
      h2: "0dccd202-97ea-4908-a240-fcba34fcce5b",
      /** H3 — SP03 ×1 = 120.000đ CANCELLED (hôm qua). */
      h3: "2df884b9-e9ee-4b13-ab9f-a8ee94996886",
      /** H4 — SP04 ×1 = 260.000đ SHIPPED (7 ngày trước). */
      h4: "4fd0f414-6d0e-48d4-8e67-a839ac4f731e",
      /** H5 — SP06 ×3 = 960.000đ PAID (7 ngày trước). */
      h5: "2804e8ef-4dae-4016-a61c-ea951ba45128",
    },
    messages: {
      khach_linh_1: "6998cab8-1777-4a78-ac32-4486650f7bc4",
      khach_linh_2: "124f8177-d3c9-4979-b0ea-93589a0f3f80",
      khach_linh_3: "fd0bf676-354e-4122-8e5e-ccfa4109dc0d",
      khach_linh_4: "e640aef5-d2dc-4858-9ce3-51f6477a3324",
      hong_linh_1: "2aa390d2-7ecc-412f-aabf-66605f812b9e",
      hong_linh_2: "a56dbcb9-d199-479c-b922-313b8dc8b540",
      hong_linh_3: "f102524d-3293-4c92-97b8-acd80813c5d7",
      hong_linh_4: "ee5fd689-f014-427c-9e94-2a362e176515",
      minh_linh_1: "8b36f8e1-7289-40ff-aa0e-de30da1802a0",
      minh_linh_2: "8c171fc3-7436-4c0a-b646-46a2b71c101d",
      minh_linh_3: "0653c93e-3474-438c-b824-d3a52e7e2e8f",
      minh_linh_4: "1a0553e4-8649-430c-b35b-61993a65c6b7",
      khach_baoan_1: "808b1bf6-cefb-481b-ba44-f581c6bffbb9",
      khach_baoan_2: "bf04e85d-fa6f-4415-9424-e24761cbdc4a",
      khach_baoan_3: "245a5ca5-bdfa-4487-a0c1-1a31df28a2fc",
      khach_baoan_4: "fddf20fa-9525-4de5-b128-4f7889e74939",
      hong_baoan_1: "8ff9a14b-2647-43c2-9fc5-f07c9a21e63d",
      hong_baoan_2: "ab236dae-e507-4821-a701-6f257307aa53",
      hong_baoan_3: "8bb3e6fa-8747-423f-b9f6-ba97e5236d0c",
      hong_baoan_4: "83f405d2-aae1-4a6e-89a9-cfffc88fc5d6",
    },
  },
} as const;
