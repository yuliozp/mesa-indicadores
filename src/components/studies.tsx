import { useCallback, useEffect, useMemo, useState, type ReactElement, type ReactNode } from "react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { getOverlay } from "@/lib/market/analyze.functions";
import type { IntervalId, OverlayPoint, OverlaySeries, RangeId } from "@/lib/market/types";

const INTERVALS: Array<{ id: IntervalId; label: string }> = [
  { id: "1m", label: "1 min" },
  { id: "5m", label: "5 min" },
  { id: "15m", label: "15 min" },
  { id: "1h", label: "1 h" },
  { id: "1d", label: "1 día" },
];

const RANGES: Array<{ id: RangeId; label: string }> = [
  { id: "1d", label: "1 día" },
  { id: "1w", label: "1 semana" },
  { id: "1mo", label: "1 mes" },
  { id: "3mo", label: "3 meses" },
  { id: "6mo", label: "6 meses" },
  { id: "1y", label: "1 año" },
  { id: "ytd", label: "Este año" },
];

const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

type MarkProps = {
  x?: number;
  width?: number;
  payload?: OverlayPoint;
  background?: { y?: number; height?: number };
};

function axisTick(t: string): string {
  if (t.length <= 10) return `${t.slice(8)}/${t.slice(5, 7)}`;
  return `${t.slice(8, 10)} ${t.slice(11, 16)}`;
}

function price(n: number): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function volFmt(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(Math.round(n));
}

function etToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function shiftIso(iso: string, days: number, months: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1 + months, d + days));
  return dt.toISOString().slice(0, 10);
}

function rangeStart(range: RangeId, today: string): string {
  if (range === "1d") return today;
  if (range === "1w") return shiftIso(today, -7, 0);
  if (range === "1mo") return shiftIso(today, 0, -1);
  if (range === "3mo") return shiftIso(today, 0, -3);
  if (range === "6mo") return shiftIso(today, 0, -6);
  if (range === "1y") return shiftIso(today, 0, -12);
  return `${today.slice(0, 4)}-01-01`;
}

function prettyDay(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${Number(d)} ${MONTHS[Number(m) - 1]} ${y}`;
}

function applyRange(points: OverlayPoint[], range: RangeId, today: string): { points: OverlayPoint[]; note: string | null } {
  if (!points.length) return { points, note: null };
  const start = rangeStart(range, today);
  const visible = points.filter((p) => p.t.slice(0, 10) >= start);
  if (!visible.length) {
    const lastDay = points[points.length - 1].t.slice(0, 10);
    return {
      points: points.filter((p) => p.t.slice(0, 10) === lastDay),
      note: "No hay velas en ese periodo. Se muestra la última sesión disponible.",
    };
  }
  const first = visible[0].t.slice(0, 10);
  if (first > start) {
    return {
      points: visible,
      note: `Esta temporalidad no cubre todo el periodo. Datos desde ${prettyDay(first)}.`,
    };
  }
  return { points: visible, note: null };
}

function priceDomain(points: OverlayPoint[], mode: "ma" | "bb"): [number, number] {
  let min = Infinity;
  let max = -Infinity;
  const take = (v: number | null) => {
    if (v == null || Number.isNaN(v)) return;
    min = Math.min(min, v);
    max = Math.max(max, v);
  };
  for (const p of points) {
    take(p.high);
    take(p.low);
    if (mode === "ma") {
      take(p.ma20);
      take(p.ma40);
      take(p.ma100);
      take(p.ma200);
    } else {
      take(p.bbUpper);
      take(p.bbLower);
    }
  }
  if (!Number.isFinite(min) || min === max) {
    const c = points[points.length - 1]?.close ?? 1;
    return [c * 0.98, c * 1.02];
  }
  const pad = (max - min) * 0.08;
  return [min - pad, max + pad];
}

export function Studies({ ticker, initial }: { ticker: string; initial: OverlaySeries }) {
  const [interval, setInterval] = useState<IntervalId>("1d");
  const [range, setRange] = useState<RangeId>("3mo");
  const [series, setSeries] = useState<OverlaySeries>(initial);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState<null | "ma" | "bb" | "worden">(null);
  const closeZoom = useCallback(() => setZoom(null), []);
  const today = useMemo(() => etToday(), []);

  useEffect(() => {
    if (interval === "1d") {
      setSeries(initial);
      setError(null);
      setPending(false);
      return;
    }
    let cancel = false;
    setPending(true);
    setError(null);
    getOverlay({ data: { ticker, interval } })
      .then((next) => {
        if (!cancel) setSeries(next);
      })
      .catch((err: unknown) => {
        if (!cancel) setError(err instanceof Error ? err.message : "No se pudo cambiar la temporalidad.");
      })
      .finally(() => {
        if (!cancel) setPending(false);
      });
    return () => {
      cancel = true;
    };
  }, [ticker, interval, initial]);

  const windowed = useMemo(() => applyRange(series.points, range, today), [series.points, range, today]);
  const visible = windowed.points;
  const rangeLabel = RANGES.find((item) => item.id === range)?.label ?? "";
  const badge = `${series.label} · ${rangeLabel}`;

  return (
    <section className="mt-4 space-y-3">
      <p className="text-xs text-muted">Toca un gráfico para abrirlo en grande. El periodo elegido se aplica a los tres.</p>
      {windowed.note ? <p className="text-xs text-put">{windowed.note}</p> : null}
      {error ? <p className="text-xs text-down">{error}</p> : null}

      <article className="rounded-lg border border-line bg-surface px-2 py-3 sm:px-4">
        <div className="flex flex-col gap-3 px-2">
          <div>
            <h3 className="text-sm text-fg">Medias móviles</h3>
            <Swatches
              items={[
                ["20", "var(--color-ma20)"],
                ["40", "var(--color-ma40)"],
                ["100", "var(--color-ma100)"],
                ["200", "var(--color-ma200)"],
              ]}
            />
            <p className="mt-1 text-xs text-muted">Vela verde si cierra al alza, roja si cierra a la baja.</p>
          </div>
          <IntervalPicker interval={interval} onChange={setInterval} />
          <RangePicker range={range} onChange={setRange} />
        </div>
        <ZoomChart label="medias móviles" pending={pending} height="h-64" badge={badge} onZoom={() => setZoom("ma")}>
          <PriceChart points={visible} mode="ma" />
        </ZoomChart>
      </article>

      <article className="rounded-lg border border-line bg-surface px-2 py-3 sm:px-4">
        <div className="flex flex-col gap-3 px-2">
          <div>
            <h3 className="text-sm text-fg">Bandas de Bollinger</h3>
            <p className="mt-1 text-xs text-muted">20 periodos, ±2 desviaciones. Misma vela y mismo periodo que las medias.</p>
          </div>
          <IntervalPicker interval={interval} onChange={setInterval} />
          <RangePicker range={range} onChange={setRange} />
        </div>
        <ZoomChart label="bandas de Bollinger" pending={pending} height="h-56" badge={badge} onZoom={() => setZoom("bb")}>
          <PriceChart points={visible} mode="bb" />
        </ZoomChart>
      </article>

      <article className="rounded-lg border border-line bg-surface px-2 py-3 sm:px-4">
        <div className="flex flex-col gap-3 px-2">
          <div>
            <h3 className="text-sm text-fg">Worden Stochastic</h3>
            <p className="mt-1 text-xs text-muted">
              Percentil del cierre, periodo 14, suavizado 3. Volumen verde si la vela es alcista y rojo si es bajista.
            </p>
          </div>
          <RangePicker range={range} onChange={setRange} />
        </div>
        <ZoomChart label="Worden Stochastic" pending={pending} height="h-52" badge={badge} onZoom={() => setZoom("worden")}>
          <WordenChart points={visible} />
        </ZoomChart>
      </article>

      {zoom ? (
        <ChartLightbox
          title={zoom === "ma" ? "Medias móviles" : zoom === "bb" ? "Bandas de Bollinger" : "Worden Stochastic"}
          onClose={closeZoom}
        >
          <div className="mb-3 flex flex-col gap-3">
            <IntervalPicker interval={interval} onChange={setInterval} />
            <RangePicker range={range} onChange={setRange} />
            {windowed.note ? <p className="text-xs text-put">{windowed.note}</p> : null}
          </div>
          <ChartBox pending={pending} height="h-[68vh]" badge={badge}>
            {zoom === "worden" ? <WordenChart points={visible} /> : <PriceChart points={visible} mode={zoom} />}
          </ChartBox>
        </ChartLightbox>
      ) : null}
    </section>
  );
}

function PriceChart({
  points,
  mode,
  width,
  height,
}: {
  points: OverlayPoint[];
  mode: "ma" | "bb";
  width?: number;
  height?: number;
}) {
  const domain = priceDomain(points, mode);
  const dots = points.length < 2;
  if (!width || !height) return null;
  return (
    <ComposedChart width={width} height={height} data={points} margin={{ top: 18, right: 8, left: 0, bottom: 0 }}>
      <CartesianGrid stroke="var(--color-line)" vertical={false} />
      <XAxis dataKey="t" tickFormatter={axisTick} tick={{ fill: "var(--color-muted)", fontSize: 11 }} minTickGap={28} />
      <YAxis
        yAxisId="p"
        domain={domain}
        allowDataOverflow
        tickFormatter={(v: number) => price(Number(v))}
        tick={{ fill: "var(--color-muted)", fontSize: 11 }}
        width={58}
      />
      <Tooltip content={<OhlcTip mode={mode} />} />
      <Bar
        yAxisId="p"
        dataKey="close"
        isAnimationActive={false}
        legendType="none"
        shape={(raw: unknown) => <CandleMark {...(raw as MarkProps)} domain={domain} />}
      />
      {mode === "ma" ? <Line yAxisId="p" type="monotone" dataKey="ma20" name="MA 20" stroke="var(--color-ma20)" dot={dots} strokeWidth={1.5} connectNulls isAnimationActive={false} /> : null}
      {mode === "ma" ? <Line yAxisId="p" type="monotone" dataKey="ma40" name="MA 40" stroke="var(--color-ma40)" dot={dots} strokeWidth={1.5} connectNulls isAnimationActive={false} /> : null}
      {mode === "ma" ? <Line yAxisId="p" type="monotone" dataKey="ma100" name="MA 100" stroke="var(--color-ma100)" dot={dots} strokeWidth={1.5} connectNulls isAnimationActive={false} /> : null}
      {mode === "ma" ? <Line yAxisId="p" type="monotone" dataKey="ma200" name="MA 200" stroke="var(--color-ma200)" dot={dots} strokeWidth={1.5} connectNulls isAnimationActive={false} /> : null}
      {mode === "bb" ? <Line yAxisId="p" type="monotone" dataKey="bbUpper" name="Superior" stroke="var(--color-call)" dot={false} strokeWidth={1.25} connectNulls isAnimationActive={false} /> : null}
      {mode === "bb" ? <Line yAxisId="p" type="monotone" dataKey="bbMid" name="Media 20" stroke="var(--color-ma20)" dot={false} strokeDasharray="4 3" connectNulls isAnimationActive={false} /> : null}
      {mode === "bb" ? <Line yAxisId="p" type="monotone" dataKey="bbLower" name="Inferior" stroke="var(--color-call)" dot={false} strokeWidth={1.25} connectNulls isAnimationActive={false} /> : null}
    </ComposedChart>
  );
}

function WordenChart({ points, width, height }: { points: OverlayPoint[]; width?: number; height?: number }) {
  const maxVol = points.reduce((max, point) => Math.max(max, point.volume), 1);
  if (!width || !height) return null;
  return (
    <ComposedChart width={width} height={height} data={points} margin={{ top: 18, right: 8, left: 0, bottom: 0 }}>
      <CartesianGrid stroke="var(--color-line)" vertical={false} />
      <XAxis dataKey="t" tickFormatter={axisTick} tick={{ fill: "var(--color-muted)", fontSize: 11 }} minTickGap={28} />
      <YAxis yAxisId="w" domain={[0, 100]} ticks={[20, 50, 80]} tick={{ fill: "var(--color-muted)", fontSize: 11 }} width={36} />
      <YAxis yAxisId="v" hide domain={[0, 1]} />
      <Tooltip content={<OhlcTip mode="worden" />} />
      <Bar
        yAxisId="v"
        dataKey="volume"
        isAnimationActive={false}
        legendType="none"
        shape={(raw: unknown) => <VolumeMark {...(raw as MarkProps)} maxVol={maxVol} />}
      />
      <ReferenceLine yAxisId="w" y={80} stroke="var(--color-down)" strokeDasharray="3 3" />
      <ReferenceLine yAxisId="w" y={20} stroke="var(--color-up)" strokeDasharray="3 3" />
      <Line yAxisId="w" type="monotone" dataKey="worden" name="Worden" stroke="var(--color-ma200)" dot={false} strokeWidth={2} connectNulls isAnimationActive={false} />
    </ComposedChart>
  );
}

function CandleMark({ x = 0, width = 0, payload, background, domain }: MarkProps & { domain: [number, number] }) {
  if (!payload || !background?.height) return <g />;
  const top = background.y ?? 0;
  const span = domain[1] - domain[0] || 1;
  const yOf = (value: number) => top + ((domain[1] - value) / span) * (background.height as number);
  const bodyW = Math.max(1.2, Math.min(14, width * 0.72));
  const cx = x + width / 2;
  const up = payload.close >= payload.open;
  const color = up ? "var(--color-up)" : "var(--color-down)";
  const yOpen = yOf(payload.open);
  const yClose = yOf(payload.close);
  return (
    <g>
      <line x1={cx} x2={cx} y1={yOf(payload.high)} y2={yOf(payload.low)} stroke={color} strokeWidth={1} />
      <rect
        x={cx - bodyW / 2}
        y={Math.min(yOpen, yClose)}
        width={bodyW}
        height={Math.max(1, Math.abs(yClose - yOpen))}
        fill={color}
      />
    </g>
  );
}

function VolumeMark({ x = 0, width = 0, payload, background, maxVol }: MarkProps & { maxVol: number }) {
  if (!payload || !background?.height || payload.volume <= 0 || maxVol <= 0) return <g />;
  const plotH = background.height;
  const h = Math.max(1, (payload.volume / maxVol) * plotH * 0.32);
  const y = (background.y ?? 0) + plotH - h;
  const bodyW = Math.max(1.2, width * 0.72);
  const up = payload.close >= payload.open;
  return (
    <rect
      x={x + (width - bodyW) / 2}
      y={y}
      width={bodyW}
      height={h}
      fill={up ? "var(--color-up)" : "var(--color-down)"}
      opacity={0.55}
    />
  );
}

function OhlcTip({
  active,
  payload,
  mode,
}: {
  active?: boolean;
  payload?: Array<{ payload?: OverlayPoint }>;
  mode: "ma" | "bb" | "worden";
}) {
  const row = payload?.[0]?.payload;
  if (!active || !row) return null;
  const up = row.close >= row.open;
  return (
    <div className="rounded-lg border border-line bg-inset px-2.5 py-2 text-xs text-fg">
      <p className="mb-1 font-mono text-muted">{row.t}</p>
      {mode === "worden" ? (
        <p>Worden {row.worden == null ? "—" : row.worden.toFixed(1)}</p>
      ) : (
        <>
          <p className={up ? "text-up" : "text-down"}>
            A {price(row.open)} · C {price(row.close)}
          </p>
          <p>
            Máx {price(row.high)} · Mín {price(row.low)}
          </p>
        </>
      )}
      <p>Vol {volFmt(row.volume)}</p>
      {mode === "ma" ? (
        <p className="mt-1 text-muted">
          20 {fmtMaybe(row.ma20)} · 40 {fmtMaybe(row.ma40)}
          <br />
          100 {fmtMaybe(row.ma100)} · 200 {fmtMaybe(row.ma200)}
        </p>
      ) : null}
      {mode === "bb" ? (
        <p className="mt-1 text-muted">
          Sup {fmtMaybe(row.bbUpper)} · Med {fmtMaybe(row.bbMid)} · Inf {fmtMaybe(row.bbLower)}
        </p>
      ) : null}
    </div>
  );
}

function fmtMaybe(n: number | null): string {
  return n == null ? "—" : price(n);
}

function IntervalPicker({ interval, onChange }: { interval: IntervalId; onChange: (id: IntervalId) => void }) {
  return (
    <div>
      <p className="mb-1 text-xs text-muted">Velas</p>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Temporalidad de las velas">
        {INTERVALS.map((item) => (
          <PickButton key={item.id} on={interval === item.id} onClick={() => onChange(item.id)}>
            {item.label}
          </PickButton>
        ))}
      </div>
    </div>
  );
}

function RangePicker({ range, onChange }: { range: RangeId; onChange: (id: RangeId) => void }) {
  return (
    <div>
      <p className="mb-1 text-xs text-muted">Periodo</p>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Periodo a visualizar">
        {RANGES.map((item) => (
          <PickButton key={item.id} on={range === item.id} onClick={() => onChange(item.id)}>
            {item.label}
          </PickButton>
        ))}
      </div>
    </div>
  );
}

function PickButton({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={
        on
          ? "h-11 rounded-lg bg-call px-3 text-sm font-medium text-bg"
          : "h-11 rounded-lg border border-line px-3 text-sm text-fg"
      }
    >
      {children}
    </button>
  );
}

function Swatches({ items }: { items: Array<[string, string]> }) {
  return (
    <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
      {items.map(([label, color]) => (
        <span key={label} className="inline-flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-4 rounded" style={{ background: color }} />
          {label}
        </span>
      ))}
    </p>
  );
}

function ZoomChart({
  children,
  pending,
  height,
  badge,
  label,
  onZoom,
}: {
  children: ReactElement;
  pending: boolean;
  height: string;
  badge: string;
  label: string;
  onZoom: () => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Ampliar gráfico de ${label}`}
      onClick={onZoom}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onZoom();
        }
      }}
      className="mt-2"
    >
      <ChartBox pending={pending} height={height} badge={badge}>
        {children}
      </ChartBox>
    </div>
  );
}

function ChartBox({
  children,
  pending,
  height,
  badge,
}: {
  children: ReactElement;
  pending: boolean;
  height: string;
  badge: string;
}) {
  return (
    <div className={`relative overflow-hidden ${height} ${pending ? "opacity-50" : ""}`}>
      <TimeBadge label={badge} />
      <ResponsiveContainer width="100%" height="100%">
        {children}
      </ResponsiveContainer>
    </div>
  );
}

function TimeBadge({ label }: { label: string }) {
  return (
    <span className="pointer-events-none absolute top-1 right-2 z-10 max-w-[70%] truncate rounded-md border border-line bg-inset px-2 py-1 font-mono text-xs text-call">
      {label}
    </span>
  );
}

export function ChartLightbox({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center bg-black/70 p-2 sm:items-center sm:p-6"
      role="presentation"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="max-h-[94vh] w-full max-w-5xl overflow-auto rounded-lg border border-line bg-surface p-3 shadow-2xl sm:p-5"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between gap-3">
          <h3 className="text-base text-fg">{title}</h3>
          <button type="button" onClick={onClose} autoFocus className="h-11 rounded-lg border border-line px-3 text-sm text-fg">
            Cerrar
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
