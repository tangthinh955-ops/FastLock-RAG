/**
 * Hợp nhất danh sách hội thoại seller giữa payload server (RSC) và state client
 * đang có tin realtime. Tách thành hàm thuần để test offline (không cần DOM).
 *
 * Quy tắc:
 * - Cùng `id`: giữ bản có `activityAt` MỚI HƠN (server thắng khi bằng nhau vì
 *   server là nguồn sự thật); payload RSC đến trễ không được kéo lùi dòng vừa
 *   được socket cập nhật.
 * - Dòng server chưa có ở client (hội thoại mới) → thêm vào.
 * - Dòng client chưa có ở server (payload cũ hơn thời điểm tin realtime) → giữ
 *   lại; hệ thống không có nghiệp vụ xoá hội thoại nên không sợ "xác sống".
 */
export type InboxRowLike = {
  id: string;
  /** ISO 8601 — mốc hoạt động max(updatedAt, lastMessage.createdAt). */
  activityAt: string;
};

export function mergeInboxRows<T extends InboxRowLike>(
  serverRows: readonly T[],
  currentRows: readonly T[],
): T[] {
  if (currentRows.length === 0) {
    return [...serverRows];
  }

  const currentById = new Map(currentRows.map((row) => [row.id, row]));
  const merged = serverRows.map((serverRow) => {
    const current = currentById.get(serverRow.id);
    if (current === undefined) {
      return serverRow;
    }
    return Date.parse(current.activityAt) > Date.parse(serverRow.activityAt)
      ? current
      : serverRow;
  });

  const serverIds = new Set(serverRows.map((row) => row.id));
  for (const row of currentRows) {
    if (!serverIds.has(row.id)) {
      merged.push(row);
    }
  }
  return merged;
}
