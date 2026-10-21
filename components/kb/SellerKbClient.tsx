"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

export type SellerKbRow = {
  id: string;
  title: string;
  answer: string;
  /** ISO string — format lúc hiển thị để không lệch server/client. */
  updatedAt: string;
};

type SellerKbClientProps = {
  shopName: string;
  entries: SellerKbRow[];
};

type FormState = {
  title: string;
  answer: string;
};

/** `null` = form đóng; create/edit quyết định method + endpoint. */
type Editing =
  | { mode: "create" }
  | { mode: "edit"; id: string };

const EMPTY_FORM: FormState = {
  title: "",
  answer: "",
};

const updatedAtFormatter = new Intl.DateTimeFormat("vi-VN", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function formatUpdatedAt(iso: string): string {
  return updatedAtFormatter.format(new Date(iso));
}

function formFromEntry(entry: SellerKbRow): FormState {
  return { title: entry.title, answer: entry.answer };
}

/** Đọc câu lỗi tiếng Việt từ contract `{ error }` của route handler. */
async function readError(response: Response): Promise<string> {
  const payload = (await response.json().catch(() => null)) as {
    error?: unknown;
  } | null;
  return typeof payload?.error === "string"
    ? payload.error
    : "Không thực hiện được thao tác, vui lòng thử lại";
}

/**
 * CRUD mục kiến thức của shop (Plan 3 Task 4): danh sách card + form thêm/sửa
 * với textarea + xoá có confirm.
 *
 * - Submit POST (tạo) / PATCH (sửa); DELETE có `window.confirm`. Server là nơi
 *   quyết định validate/404 — câu lỗi tiếng Việt hiện nguyên trong banner.
 * - Thành công đóng form + `router.refresh()` để server component đọc lại DB.
 * - Service đã invalidate index RAG sau mỗi mutation; UI nhắc seller điều đó.
 */
export default function SellerKbClient({
  shopName,
  entries,
}: SellerKbClientProps) {
  const router = useRouter();
  const [editing, setEditing] = useState<Editing | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const busy = saving || deletingId !== null;

  function closeForm() {
    setEditing(null);
    setForm(EMPTY_FORM);
  }

  function openCreate() {
    setError(null);
    setEditing({ mode: "create" });
    setForm(EMPTY_FORM);
  }

  function openEdit(entry: SellerKbRow) {
    setError(null);
    setEditing({ mode: "edit", id: entry.id });
    setForm(formFromEntry(entry));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (editing === null || busy) return;

    if (form.title.trim() === "" || form.answer.trim() === "") {
      setError("Vui lòng nhập đủ tiêu đề và nội dung trả lời");
      return;
    }

    setError(null);
    setSaving(true);
    try {
      const isEdit = editing.mode === "edit";
      const response = await fetch(
        isEdit ? `/api/seller/kb/${editing.id}` : "/api/seller/kb",
        {
          method: isEdit ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: form.title,
            answer: form.answer,
          }),
        },
      );
      if (!response.ok) {
        setError(await readError(response));
        return;
      }
      closeForm();
      router.refresh();
    } catch {
      setError("Không kết nối được máy chủ, vui lòng thử lại");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(entry: SellerKbRow) {
    if (busy) return;
    if (
      !window.confirm(
        `Xoá mục kiến thức “${entry.title}”? AI sẽ không còn dùng nội dung này.`,
      )
    ) {
      return;
    }

    setError(null);
    setDeletingId(entry.id);
    try {
      const response = await fetch(`/api/seller/kb/${entry.id}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        setError(await readError(response));
        return;
      }
      if (editing?.mode === "edit" && editing.id === entry.id) {
        closeForm();
      }
      router.refresh();
    } catch {
      setError("Không kết nối được máy chủ, vui lòng thử lại");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            📚 Kiến thức của shop
          </h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Câu trả lời AI dùng cho{" "}
            <strong className="font-semibold">{shopName}</strong> — thêm, sửa,
            xoá mục kiến thức về đổi trả, ship, bảo hành…
          </p>
        </div>
        <button
          type="button"
          onClick={openCreate}
          disabled={busy}
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 disabled:cursor-not-allowed disabled:opacity-60"
        >
          + Thêm mục kiến thức
        </button>
      </div>

      <p className="mt-3 rounded-xl border border-sky-200 bg-sky-50 px-4 py-2.5 text-xs text-sky-800 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-300">
        Sửa hoặc xoá mục kiến thức sẽ làm AI trả lời bằng nội dung mới ngay ở câu
        hỏi kế tiếp.
      </p>

      {error !== null && (
        <p
          role="alert"
          className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
        >
          {error}
        </p>
      )}

      {editing !== null && (
        <form
          onSubmit={handleSubmit}
          className="mt-6 rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-950"
        >
          <h2 className="text-lg font-semibold tracking-tight">
            {editing.mode === "create"
              ? "Thêm mục kiến thức"
              : "Sửa mục kiến thức"}
          </h2>

          <label className="mt-4 block text-sm">
            <span className="font-medium">Tiêu đề</span>
            <input
              value={form.title}
              onChange={(event) =>
                setForm((previous) => ({
                  ...previous,
                  title: event.target.value,
                }))
              }
              required
              maxLength={120}
              placeholder="VD: Chính sách đổi trả"
              className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200 dark:border-zinc-700 dark:bg-zinc-900 dark:focus:ring-emerald-900"
            />
            <span className="mt-1 block text-xs text-zinc-500 dark:text-zinc-400">
              1–120 ký tự.
            </span>
          </label>

          <label className="mt-4 block text-sm">
            <span className="font-medium">Nội dung trả lời</span>
            <textarea
              value={form.answer}
              onChange={(event) =>
                setForm((previous) => ({
                  ...previous,
                  answer: event.target.value,
                }))
              }
              required
              maxLength={4000}
              rows={6}
              placeholder="VD: Đổi trả trong 7 ngày nếu sản phẩm còn tag."
              className="mt-1 w-full resize-y rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200 dark:border-zinc-700 dark:bg-zinc-900 dark:focus:ring-emerald-900"
            />
            <span className="mt-1 block text-xs text-zinc-500 dark:text-zinc-400">
              1–4000 ký tự. AI dùng nguyên văn nội dung này khi trả lời.
            </span>
          </label>

          <div className="mt-5 flex flex-wrap items-center gap-2">
            <button
              type="submit"
              disabled={busy}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saving
                ? "Đang lưu…"
                : editing.mode === "create"
                  ? "Thêm mục kiến thức"
                  : "Lưu thay đổi"}
            </button>
            <button
              type="button"
              onClick={closeForm}
              disabled={saving}
              className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:hover:bg-zinc-900"
            >
              Hủy
            </button>
          </div>
        </form>
      )}

      {entries.length === 0 ? (
        <div className="mt-8 rounded-2xl border border-dashed border-zinc-300 px-6 py-14 text-center dark:border-zinc-700">
          <span
            aria-hidden
            className="mx-auto grid size-14 place-items-center rounded-2xl bg-emerald-50 text-3xl dark:bg-emerald-950/50"
          >
            📚
          </span>
          <p className="mx-auto mt-3 max-w-md text-sm text-zinc-600 dark:text-zinc-400">
            Shop chưa có mục kiến thức nào — thêm mục đầu tiên để AI trả lời
            đúng về đổi trả, ship, bảo hành…
          </p>
          <button
            type="button"
            onClick={openCreate}
            disabled={busy}
            className="mt-4 inline-flex items-center rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            + Thêm mục kiến thức
          </button>
        </div>
      ) : (
        <ul className="mt-6 grid gap-3">
          {entries.map((entry) => {
            const deleting = deletingId === entry.id;
            return (
              <li
                key={entry.id}
                className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-950"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <h2 className="min-w-0 text-base font-semibold tracking-tight">
                    {entry.title}
                  </h2>
                  <div className="flex shrink-0 gap-2">
                    <button
                      type="button"
                      onClick={() => openEdit(entry)}
                      disabled={busy}
                      className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-semibold transition hover:bg-zinc-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:hover:bg-zinc-900"
                    >
                      Sửa
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDelete(entry)}
                      disabled={busy}
                      className="rounded-lg border border-red-300 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 transition hover:bg-red-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600 disabled:cursor-not-allowed disabled:opacity-60 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300 dark:hover:bg-red-950/70"
                    >
                      {deleting ? "Đang xoá…" : "Xóa"}
                    </button>
                  </div>
                </div>
                <p className="mt-2 line-clamp-3 text-sm whitespace-pre-line text-zinc-600 dark:text-zinc-400">
                  {entry.answer}
                </p>
                <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
                  Cập nhật {formatUpdatedAt(entry.updatedAt)}
                </p>
              </li>
            );
          })}
        </ul>
      )}

      <p className="mt-4 text-xs text-zinc-500 dark:text-zinc-400">
        Mục kiến thức thuộc riêng shop này — shop khác không thấy và không sửa
        được.
      </p>
    </main>
  );
}
