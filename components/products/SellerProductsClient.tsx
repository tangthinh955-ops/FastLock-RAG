"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useState, type ChangeEvent, type FormEvent } from "react";

export type SellerProductRow = {
  id: string;
  sku: string;
  name: string;
  price: number;
  stock: number;
  imageUrl: string | null;
};

type SellerProductsClientProps = {
  shopName: string;
  products: SellerProductRow[];
};

type FormState = {
  sku: string;
  name: string;
  price: string;
  stock: string;
  imageUrl: string | null;
};

/** `null` = form đóng; create/edit quyết định method + endpoint. */
type Editing =
  | { mode: "create" }
  | { mode: "edit"; id: string };

const EMPTY_FORM: FormState = {
  sku: "",
  name: "",
  price: "",
  stock: "",
  imageUrl: null,
};

const priceFormatter = new Intl.NumberFormat("vi-VN", {
  maximumFractionDigits: 0,
});

function formatVnd(value: number): string {
  return `${priceFormatter.format(value)}đ`;
}

function formFromProduct(product: SellerProductRow): FormState {
  return {
    sku: product.sku,
    name: product.name,
    price: String(product.price),
    stock: String(product.stock),
    imageUrl: product.imageUrl,
  };
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
 * CRUD sản phẩm của shop (Plan 3 Task 3): bảng + form thêm/sửa + upload ảnh.
 *
 * - Ảnh upload NGAY khi chọn file (`POST /api/seller/products/upload`), preview
 *   từ URL server trả về; "Bỏ ảnh" đặt `imageUrl = null`. Không dùng object URL
 *   local vì DB cần đường dẫn `/uploads/…` thật.
 * - Submit POST (tạo) / PATCH (sửa); DELETE có `window.confirm`. Server là nơi
 *   quyết định validate/409/404 — câu lỗi tiếng Việt hiện nguyên trong banner.
 * - Thành công đóng form + `router.refresh()` để server component đọc lại DB.
 * - SKU/tên đổi thì service đã invalidate index RAG; UI nhắc seller điều đó.
 */
export default function SellerProductsClient({
  shopName,
  products,
}: SellerProductsClientProps) {
  const router = useRouter();
  const [editing, setEditing] = useState<Editing | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const busy = saving || uploading || deletingId !== null;

  function closeForm() {
    setEditing(null);
    setForm(EMPTY_FORM);
  }

  function openCreate() {
    setError(null);
    setEditing({ mode: "create" });
    setForm(EMPTY_FORM);
  }

  function openEdit(product: SellerProductRow) {
    setError(null);
    setEditing({ mode: "edit", id: product.id });
    setForm(formFromProduct(product));
  }

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Xoá value để chọn lại đúng file vừa bỏ vẫn kích hoạt onChange.
    event.target.value = "";
    if (!file) return;

    setError(null);
    setUploading(true);
    try {
      const data = new FormData();
      data.append("file", file);
      const response = await fetch("/api/seller/products/upload", {
        method: "POST",
        body: data,
      });
      if (!response.ok) {
        setError(await readError(response));
        return;
      }
      const payload = (await response.json().catch(() => null)) as {
        url?: unknown;
      } | null;
      if (typeof payload?.url !== "string") {
        setError("Tải ảnh thất bại, vui lòng thử lại");
        return;
      }
      const url = payload.url;
      setForm((previous) => ({ ...previous, imageUrl: url }));
    } catch {
      setError("Không kết nối được máy chủ, vui lòng thử lại");
    } finally {
      setUploading(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (editing === null || busy) return;

    if (
      form.sku.trim() === "" ||
      form.name.trim() === "" ||
      form.price.trim() === "" ||
      form.stock.trim() === ""
    ) {
      setError("Vui lòng nhập đủ SKU, tên, giá và kho");
      return;
    }

    setError(null);
    setSaving(true);
    try {
      const isEdit = editing.mode === "edit";
      const response = await fetch(
        isEdit ? `/api/seller/products/${editing.id}` : "/api/seller/products",
        {
          method: isEdit ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sku: form.sku,
            name: form.name,
            price: Number(form.price),
            stock: Number(form.stock),
            imageUrl: form.imageUrl,
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

  async function handleDelete(product: SellerProductRow) {
    if (busy) return;
    if (
      !window.confirm(`Xoá sản phẩm “${product.name}”? Thao tác không hoàn tác được.`)
    ) {
      return;
    }

    setError(null);
    setDeletingId(product.id);
    try {
      const response = await fetch(`/api/seller/products/${product.id}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        setError(await readError(response));
        return;
      }
      if (editing?.mode === "edit" && editing.id === product.id) {
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
    <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            🧦 Sản phẩm của shop
          </h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Sản phẩm của{" "}
            <strong className="font-semibold">{shopName}</strong> — thêm, sửa,
            xoá và tải ảnh cho danh mục bán trong live.
          </p>
        </div>
        <button
          type="button"
          onClick={openCreate}
          disabled={busy}
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 disabled:cursor-not-allowed disabled:opacity-60"
        >
          + Thêm sản phẩm
        </button>
      </div>

      <p className="mt-3 rounded-xl border border-sky-200 bg-sky-50 px-4 py-2.5 text-xs text-sky-800 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-300">
        Sửa tên/SKU sẽ làm AI dùng dữ liệu mới ngay ở câu hỏi kế tiếp.
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
            {editing.mode === "create" ? "Thêm sản phẩm" : "Sửa sản phẩm"}
          </h2>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="font-medium">SKU</span>
              <input
                value={form.sku}
                onChange={(event) =>
                  setForm((previous) => ({ ...previous, sku: event.target.value }))
                }
                required
                maxLength={20}
                placeholder="VD: AO01"
                className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200 dark:border-zinc-700 dark:bg-zinc-900 dark:focus:ring-emerald-900"
              />
              <span className="mt-1 block text-xs text-zinc-500 dark:text-zinc-400">
                2–20 ký tự: chữ, số, gạch dưới hoặc gạch ngang.
              </span>
            </label>

            <label className="block text-sm">
              <span className="font-medium">Tên sản phẩm</span>
              <input
                value={form.name}
                onChange={(event) =>
                  setForm((previous) => ({ ...previous, name: event.target.value }))
                }
                required
                maxLength={120}
                placeholder="VD: Áo thun basic"
                className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200 dark:border-zinc-700 dark:bg-zinc-900 dark:focus:ring-emerald-900"
              />
            </label>

            <label className="block text-sm">
              <span className="font-medium">Giá (VND)</span>
              <input
                type="number"
                inputMode="numeric"
                min={0}
                max={100_000_000}
                step={1}
                value={form.price}
                onChange={(event) =>
                  setForm((previous) => ({ ...previous, price: event.target.value }))
                }
                required
                placeholder="150000"
                className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200 dark:border-zinc-700 dark:bg-zinc-900 dark:focus:ring-emerald-900"
              />
            </label>

            <label className="block text-sm">
              <span className="font-medium">Kho</span>
              <input
                type="number"
                inputMode="numeric"
                min={0}
                max={100_000}
                step={1}
                value={form.stock}
                onChange={(event) =>
                  setForm((previous) => ({ ...previous, stock: event.target.value }))
                }
                required
                placeholder="10"
                className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200 dark:border-zinc-700 dark:bg-zinc-900 dark:focus:ring-emerald-900"
              />
            </label>
          </div>

          <div className="mt-4 rounded-xl border border-dashed border-zinc-300 p-4 dark:border-zinc-700">
            <p className="text-sm font-medium">Ảnh sản phẩm</p>
            <div className="mt-3 flex flex-wrap items-center gap-4">
              {form.imageUrl !== null ? (
                <Image
                  src={form.imageUrl}
                  alt="Ảnh sản phẩm"
                  width={80}
                  height={80}
                  unoptimized
                  className="size-20 rounded-lg border border-zinc-200 object-cover dark:border-zinc-700"
                />
              ) : (
                <span
                  aria-hidden
                  className="grid size-20 place-items-center rounded-lg bg-zinc-100 text-xs text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400"
                >
                  Chưa có ảnh
                </span>
              )}

              <div className="flex flex-col gap-2">
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={handleFileChange}
                  disabled={busy}
                  className="text-xs file:mr-3 file:rounded-lg file:border-0 file:bg-emerald-600 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-white hover:file:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
                />
                <span className="text-xs text-zinc-500 dark:text-zinc-400">
                  {uploading
                    ? "Đang tải ảnh…"
                    : "JPG, PNG hoặc WEBP — tối đa 2 MB."}
                </span>
                {form.imageUrl !== null && (
                  <button
                    type="button"
                    onClick={() =>
                      setForm((previous) => ({ ...previous, imageUrl: null }))
                    }
                    disabled={busy}
                    className="self-start rounded-lg border border-zinc-300 px-3 py-1 text-xs font-medium transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:hover:bg-zinc-900"
                  >
                    Bỏ ảnh
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-2">
            <button
              type="submit"
              disabled={busy}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saving
                ? "Đang lưu…"
                : editing.mode === "create"
                  ? "Thêm sản phẩm"
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

      {products.length === 0 ? (
        <div className="mt-8 rounded-2xl border border-dashed border-zinc-300 px-6 py-14 text-center dark:border-zinc-700">
          <span
            aria-hidden
            className="mx-auto grid size-14 place-items-center rounded-2xl bg-emerald-50 text-3xl dark:bg-emerald-950/50"
          >
            🧦
          </span>
          <p className="mx-auto mt-3 max-w-md text-sm text-zinc-600 dark:text-zinc-400">
            Shop chưa có sản phẩm nào — thêm sản phẩm đầu tiên để bán trong
            live.
          </p>
          <button
            type="button"
            onClick={openCreate}
            disabled={busy}
            className="mt-4 inline-flex items-center rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            + Thêm sản phẩm
          </button>
        </div>
      ) : (
        <div className="mt-6 overflow-x-auto rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
          <table className="w-full min-w-[44rem] border-collapse text-left text-sm">
            <thead className="border-b border-zinc-200 bg-zinc-50 text-xs tracking-wide text-zinc-500 uppercase dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-400">
              <tr>
                <th scope="col" className="px-4 py-3 font-semibold">
                  Sản phẩm
                </th>
                <th scope="col" className="px-4 py-3 font-semibold">
                  SKU
                </th>
                <th scope="col" className="px-4 py-3 text-right font-semibold">
                  Giá
                </th>
                <th scope="col" className="px-4 py-3 text-right font-semibold">
                  Kho
                </th>
                <th scope="col" className="px-4 py-3 text-right font-semibold">
                  Hành động
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {products.map((product) => {
                const deleting = deletingId === product.id;
                return (
                  <tr key={product.id}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        {product.imageUrl !== null ? (
                          <Image
                            src={product.imageUrl}
                            alt=""
                            width={40}
                            height={40}
                            unoptimized
                            className="size-10 shrink-0 rounded-lg border border-zinc-200 object-cover dark:border-zinc-700"
                          />
                        ) : (
                          <span
                            aria-hidden
                            className="grid size-10 shrink-0 place-items-center rounded-lg bg-emerald-50 text-sm font-semibold text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"
                          >
                            {product.name.trim().charAt(0).toUpperCase() || "?"}
                          </span>
                        )}
                        <span className="max-w-[18rem] truncate font-medium">
                          {product.name}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-zinc-600 tabular-nums dark:text-zinc-400">
                      {product.sku}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold whitespace-nowrap tabular-nums">
                      {formatVnd(product.price)}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap tabular-nums">
                      {product.stock}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => openEdit(product)}
                          disabled={busy}
                          className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-semibold transition hover:bg-zinc-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:hover:bg-zinc-900"
                        >
                          Sửa
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDelete(product)}
                          disabled={busy}
                          className="rounded-lg border border-red-300 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 transition hover:bg-red-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600 disabled:cursor-not-allowed disabled:opacity-60 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300 dark:hover:bg-red-950/70"
                        >
                          {deleting ? "Đang xoá…" : "Xóa"}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-4 text-xs text-zinc-500 dark:text-zinc-400">
        SKU là duy nhất trong shop. Sản phẩm đã có đơn không xoá được — hãy sửa
        thay vì xoá.
      </p>
    </main>
  );
}
