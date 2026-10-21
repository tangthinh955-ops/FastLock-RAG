const priceFormatter = new Intl.NumberFormat("vi-VN", {
  maximumFractionDigits: 0,
});

function formatVnd(value: number): string {
  return `${priceFormatter.format(value)}đ`;
}

/** 24 bucket giờ VN (0–23) do `getDashboardStats` trả về. */
export type RevenueChartData = { hour: number; revenue: number }[];

const WIDTH = 720;
const HEIGHT = 220;
const PADDING_TOP = 12;
const PADDING_RIGHT = 8;
const PADDING_BOTTOM = 28;
const PADDING_LEFT = 12;
const PLOT_WIDTH = WIDTH - PADDING_LEFT - PADDING_RIGHT;
const PLOT_HEIGHT = HEIGHT - PADDING_TOP - PADDING_BOTTOM;
const SLOT_WIDTH = PLOT_WIDTH / 24;
const BAR_WIDTH = Math.max(2, SLOT_WIDTH * 0.62);
/** Nhãn trục hoành theo brief — chỉ 5 mốc để không rối. */
const AXIS_HOURS = [0, 6, 12, 18, 23] as const;

/**
 * Biểu đồ cột doanh thu 24 giờ (Plan 3 Task 5) — server component, SVG thuần,
 * không thêm thư viện chart. Mỗi cột có `<title>` "10h — 300.000đ" để rê chuột
 * đọc số; nhãn trục chỉ 0/6/12/18/23.
 *
 * Dữ liệu đã là giờ VN từ service (bucket 0 = 00:00–01:00 VN), component không
 * đổi múi giờ lần nữa.
 */
export default function RevenueChart({
  data,
}: {
  data: RevenueChartData;
}) {
  const total = data.reduce((sum, bucket) => sum + bucket.revenue, 0);

  if (total === 0) {
    return (
      <div className="mt-4 rounded-xl border border-dashed border-zinc-300 px-6 py-12 text-center text-sm text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">
        Chưa có doanh thu trong khoảng này
      </div>
    );
  }

  const maxRevenue = Math.max(...data.map((bucket) => bucket.revenue));

  return (
    <div className="mt-4">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label="Biểu đồ doanh thu theo giờ Việt Nam"
        className="h-auto w-full"
      >
        <title>Doanh thu theo giờ (giờ Việt Nam)</title>

        {/* Đường đáy + lưới ngang nhẹ để dễ đọc chiều cao cột. */}
        {[0, 0.5, 1].map((ratio) => {
          const y = PADDING_TOP + PLOT_HEIGHT * (1 - ratio);
          return (
            <line
              key={ratio}
              x1={PADDING_LEFT}
              x2={WIDTH - PADDING_RIGHT}
              y1={y}
              y2={y}
              className="stroke-zinc-200 dark:stroke-zinc-800"
              strokeWidth={1}
            />
          );
        })}

        {data.map((bucket) => {
          const barHeight =
            maxRevenue === 0
              ? 0
              : (bucket.revenue / maxRevenue) * PLOT_HEIGHT;
          const x =
            PADDING_LEFT + bucket.hour * SLOT_WIDTH + (SLOT_WIDTH - BAR_WIDTH) / 2;
          const y = PADDING_TOP + PLOT_HEIGHT - barHeight;

          return (
            <rect
              key={bucket.hour}
              x={x}
              y={y}
              width={BAR_WIDTH}
              height={barHeight}
              rx={2}
              className="fill-emerald-500"
            >
              <title>{`${bucket.hour}h — ${formatVnd(bucket.revenue)}`}</title>
            </rect>
          );
        })}

        {AXIS_HOURS.map((hour) => {
          const x = PADDING_LEFT + hour * SLOT_WIDTH + SLOT_WIDTH / 2;
          return (
            <text
              key={hour}
              x={x}
              y={HEIGHT - 8}
              textAnchor={hour === 0 ? "start" : hour === 23 ? "end" : "middle"}
              className="fill-zinc-500 text-[11px] dark:fill-zinc-400"
            >
              {hour}h
            </text>
          );
        })}
      </svg>
    </div>
  );
}
