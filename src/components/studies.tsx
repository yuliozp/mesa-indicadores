import { useCallback, useEffect, useMemo, useState, type ReactElement, type ReactNode } from "react";
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Customized,
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

/** Paleta y reglas visuales al estilo TC2000: fondo negro, velas verde/rojo puras, banda gris con borde turquesa. */
export const TC = {
  bg: "#000000",
  grid: "#2b2b2b",
  axis: "#a3a3a3",
  up: "#16f02a",
  down: "#ff2b2b",
  band: "#5fc4c4",
  bandFill: "#8a8a8a",
  last: "#7d7d7d",
  close: "#ffd400",
  open: "#3b82f6",
  ath: "#2f6bff",
  ma20: "#e6c84a",
  ma40: "#e15b64",
  ma100: "#3dbe6a",
  ma200: "#b07cff",
  watermark: "rgba(170,170,170,0.22)",
} as const;

export type ChartIdentity = { ticker: string; name?: string | null; sector?: string | null; industry?: string | null };

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

export type ChartLevels = {
  /** Cierre del último día de mercado completo. */
  lastClose: number | null;
  lastCloseDay: string | null;
  /** Apertura de la última sesión. */
  lastOpen: number | null;
  lastOpenDay: string | null;
  ath: number | null;
  athDate: string | null;
};

function etNowMinutes(): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return get("hour") * 60 + get("minute");
}

/** Cierre del último día completo y apertura de la última sesión, a partir de las velas diarias. */
export function sessionLevels(daily: OverlayPoint[], ath: number | null, athDate: string | null): ChartLevels {
  const last = daily[daily.length - 1];
  if (!last) return { lastClose: null, lastCloseDay: null, lastOpen: null, lastOpenDay: null, ath, athDate };
  const today = etToday();
  const inSession = last.t.slice(0, 10) === today && etNowMinutes() < 16 * 60;
  const closeBar = inSession ? daily[daily.length - 2] : last;
  return {
    lastClose: closeBar?.close ?? null,
    lastCloseDay: closeBar?.t.slice(0, 10) ?? null,
    lastOpen: last.open,
    lastOpenDay: last.t.slice(0, 10),
    ath,
    athDate,
  };
}

type ChartKey = "ma" | "bb" | "worden";
const MIN_BARS = 12;

/** Rueda del mouse: hacia arriba acerca (menos velas), hacia abajo aleja (más velas), anclado en la última vela. */
export function useWheelZoom(total: number, count: number, setCount: (n: number) => void) {
  const [node, setNode] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!node) return;
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey) return;
      event.preventDefault();
      const factor = event.deltaY < 0 ? 1 / 1.18 : 1.18;
      const next = Math.round(count * factor);
      const clamped = Math.max(Math.min(MIN_BARS, total), Math.min(total, next === count ? count + (event.deltaY < 0 ? -1 : 1) : next));
      if (clamped !== count) setCount(clamped);
    };
    node.addEventListener("wheel", onWheel, { passive: false });
    return () => node.removeEventListener("wheel", onWheel);
  }, [node, total, count, setCount]);
  return setNode;
}

export function Studies({
  ticker,
  initial,
  identity,
  ath = null,
  athDate = null,
}: {
  ticker: string;
  initial: OverlaySeries;
  identity?: ChartIdentity;
  ath?: number | null;
  athDate?: string | null;
}) {
  const id: ChartIdentity = identity ?? { ticker };
  const [interval, setInterval] = useState<IntervalId>("1d");
  const [range, setRange] = useState<RangeId>("3mo");
  const [series, setSeries] = useState<OverlaySeries>(initial);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState<null | ChartKey>(null);
  const closeZoom = useCallback(() => setZoom(null), []);
  const today = useMemo(() => etToday(), []);
  const levels = useMemo(() => sessionLevels(initial.points, ath, athDate), [initial.points, ath, athDate]);

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
  const total = series.points.length;
  const base = Math.max(1, windowed.points.length);
  // cada gráfico tiene su propio zoom; el periodo elegido los vuelve a alinear
  const [counts, setCounts] = useState<Record<ChartKey, number>>({ ma: base, bb: base, worden: base });
  useEffect(() => setCounts({ ma: base, bb: base, worden: base }), [base, series]);
  const setter = useCallback((key: ChartKey) => (n: number) => setCounts((c) => ({ ...c, [key]: n })), []);
  const view = (key: ChartKey) => {
    const n = Math.min(total, Math.max(1, counts[key]));
    return n === base ? windowed.points : series.points.slice(-n);
  };
  const rangeLabel = RANGES.find((item) => item.id === range)?.label ?? "";
  const badgeFor = (key: ChartKey) =>
    counts[key] === base ? `${series.label} · ${rangeLabel}` : `${series.label} · ${view(key).length} velas`;

  return (
    <section className="mt-4 space-y-3">
      <p className="text-xs text-muted">
        Rueda del mouse sobre un gráfico: hacia arriba acerca, hacia abajo aleja (cada gráfico por separado). Toca para
        abrirlo en grande. El periodo vuelve a alinear los tres.
      </p>
      <LevelsLegend levels={levels} />
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
        <ZoomChart label="medias móviles" pending={pending} height="h-72" badge={badgeFor("ma")} identity={id} onZoom={() => setZoom("ma")} total={total} count={counts.ma} setCount={setter("ma")}>
          <PriceChart points={view("ma")} mode="ma" levels={levels} />
        </ZoomChart>
      </article>

      <article className="rounded-lg border border-line bg-surface px-2 py-3 sm:px-4">
        <div className="flex flex-col gap-3 px-2">
          <div>
            <h3 className="text-sm text-fg">Bandas de Bollinger</h3>
            <p className="mt-1 text-xs text-muted">20 periodos, ±2 desviaciones: la banda gris es el canal y la línea turquesa del medio es la media de 20.</p>
          </div>
          <IntervalPicker interval={interval} onChange={setInterval} />
          <RangePicker range={range} onChange={setRange} />
        </div>
        <ZoomChart label="bandas de Bollinger" pending={pending} height="h-64" badge={badgeFor("bb")} identity={id} onZoom={() => setZoom("bb")} total={total} count={counts.bb} setCount={setter("bb")}>
          <PriceChart points={view("bb")} mode="bb" levels={levels} />
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
        <ZoomChart label="Worden Stochastic" pending={pending} height="h-52" badge={badgeFor("worden")} identity={id} onZoom={() => setZoom("worden")} total={total} count={counts.worden} setCount={setter("worden")}>
          <WordenChart points={view("worden")} />
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
          <WheelBox total={total} count={counts[zoom]} setCount={setter(zoom)}>
            <ChartBox pending={pending} height="h-[68vh]" badge={badgeFor(zoom)} identity={id}>
              {zoom === "worden" ? <WordenChart points={view(zoom)} /> : <PriceChart points={view(zoom)} mode={zoom} levels={levels} />}
            </ChartBox>
          </WheelBox>
        </ChartLightbox>
      ) : null}
    </section>
  );
}

export function LevelsLegend({ levels }: { levels: ChartLevels }) {
  const items: Array<[string, string, boolean, number | null, string | null]> = [
    ["Cierre último día", TC.close, true, levels.lastClose, levels.lastCloseDay],
    ["Apertura última sesión", TC.open, true, levels.lastOpen, levels.lastOpenDay],
    ["Máximo histórico", TC.ath, false, levels.ath, levels.athDate],
  ];
  return (
    <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
      {items.map(([label, color, dashed, value, day]) => (
        <span key={label} className="inline-flex items-center gap-1.5">
          <span className="inline-block w-5 border-t-2" style={{ borderColor: color, borderStyle: dashed ? "dashed" : "solid" }} />
          {label} <span className="font-mono text-fg">{value == null ? "—" : price(value)}</span>
          {day ? <span className="text-muted">({prettyDay(day)})</span> : null}
        </span>
      ))}
    </p>
  );
}

export type Tag = { key: string; value: number; color: string; text: string };

/**
 * Banderitas de valor pegadas a la escala derecha, como en TC2000. Se calculan
 * con la escala real del eje y se separan solas cuando dos valores quedan juntos.
 */
export function TagStack({ tags, axisId, ...chart }: { tags: Tag[]; axisId: string } & Record<string, unknown>) {
  const axisMap = chart.yAxisMap as Record<string, { scale: (v: number) => number; x: number; y: number; height: number }> | undefined;
  const axis = axisMap?.[axisId];
  if (!axis) return null;
  const top = axis.y;
  const bottom = axis.y + axis.height;
  const H = 16;
  const placed = tags
    .map((t) => ({ ...t, y: axis.scale(t.value) }))
    .filter((t) => Number.isFinite(t.y) && t.y >= top - 2 && t.y <= bottom + 2)
    .sort((a, b) => a.y - b.y);
  // empuja hacia abajo las que se pisan y, si se salen, las sube desde el fondo
  for (let i = 1; i < placed.length; i++) placed[i].y = Math.max(placed[i].y, placed[i - 1].y + H);
  for (let i = placed.length - 1; i >= 0; i--) {
    const limit = i === placed.length - 1 ? bottom - H / 2 : placed[i + 1].y - H;
    placed[i].y = Math.min(placed[i].y, limit);
  }
  return (
    <g>
      {placed.map((t) => {
        const label = price(t.value);
        const w = Math.max(56, label.length * 7 + 10);
        return (
          <g key={t.key}>
            <rect x={axis.x + 1} y={t.y - H / 2} width={w} height={H} rx={2} fill={t.color} />
            <text x={axis.x + 5} y={t.y + 4} fontSize={11} fontFamily="IBM Plex Mono, monospace" fill={t.text}>
              {label}
            </text>
          </g>
        );
      })}
    </g>
  );
}

function levelLine(key: string, value: number | null, color: string, opts: { dash?: string; width?: number } = {}) {
  if (value == null || Number.isNaN(value)) return null;
  return <ReferenceLine key={key} yAxisId="p" y={value} ifOverflow="hidden" stroke={color} strokeWidth={opts.width ?? 1} strokeDasharray={opts.dash} />;
}

function PriceChart({
  points,
  mode,
  levels,
  width,
  height,
}: {
  points: OverlayPoint[];
  mode: "ma" | "bb";
  levels: ChartLevels;
  width?: number;
  height?: number;
}) {
  const baseDomain = priceDomain(points, mode);
  // el máximo histórico entra en la escala si está cerca; si está lejos se avisa arriba
  let domain = baseDomain;
  const athNear = levels.ath != null && levels.ath <= baseDomain[1] + (baseDomain[1] - baseDomain[0]) * 0.6;
  if (levels.ath != null && athNear && levels.ath > baseDomain[1]) {
    domain = [baseDomain[0], levels.ath + (baseDomain[1] - baseDomain[0]) * 0.05];
  }
  const dots = points.length < 2;
  if (!width || !height) return null;
  const last = points[points.length - 1];
  const up = last ? last.close >= last.open : true;
  const tags: Tag[] = [];
  const add = (key: string, value: number | null | undefined, color: string, text = "#000") => {
    if (value != null && !Number.isNaN(value)) tags.push({ key, value, color, text });
  };
  if (mode === "ma") {
    add("t20", last?.ma20, TC.ma20);
    add("t40", last?.ma40, TC.ma40, "#fff");
    add("t100", last?.ma100, TC.ma100);
    add("t200", last?.ma200, TC.ma200, "#fff");
  } else {
    add("bu", last?.bbUpper, TC.band);
    add("bm", last?.bbMid, TC.band);
    add("bl", last?.bbLower, TC.band);
  }
  if (athNear) add("ath", levels.ath, TC.ath, "#fff");
  add("open", levels.lastOpen, TC.open, "#fff");
  add("close", levels.lastClose, TC.close);
  add("now", last?.close, up ? TC.up : TC.down);
  return (
    <ComposedChart width={width} height={height} data={points} margin={{ top: 22, right: 0, left: 6, bottom: 0 }}>
      <CartesianGrid stroke={TC.grid} strokeWidth={1} />
      <XAxis dataKey="t" tickFormatter={axisTick} tick={{ fill: TC.axis, fontSize: 11 }} axisLine={{ stroke: TC.grid }} tickLine={false} minTickGap={36} />
      <YAxis
        yAxisId="p"
        orientation="right"
        domain={domain}
        allowDataOverflow
        tickFormatter={(v: number) => price(Number(v))}
        tick={{ fill: TC.axis, fontSize: 11 }}
        axisLine={{ stroke: TC.grid }}
        tickLine={false}
        width={66}
      />
      <Tooltip content={<OhlcTip mode={mode} />} cursor={{ stroke: "#555", strokeDasharray: "3 3" }} />
      {mode === "bb" ? (
        <Area
          yAxisId="p"
          type="monotone"
          dataKey={(p: OverlayPoint) => (p.bbLower == null || p.bbUpper == null ? null : [p.bbLower, p.bbUpper])}
          name="Banda"
          stroke={TC.band}
          strokeWidth={1}
          fill={TC.bandFill}
          fillOpacity={0.38}
          connectNulls
          isAnimationActive={false}
          activeDot={false}
        />
      ) : null}
      {mode === "bb" ? <Line yAxisId="p" type="monotone" dataKey="bbMid" name="Media 20" stroke={TC.band} dot={false} strokeWidth={1} connectNulls isAnimationActive={false} activeDot={false} /> : null}
      <Bar
        yAxisId="p"
        dataKey="close"
        isAnimationActive={false}
        legendType="none"
        shape={(raw: unknown) => <CandleMark {...(raw as MarkProps)} domain={domain} />}
      />
      {mode === "ma" ? <Line yAxisId="p" type="monotone" dataKey="ma20" name="MA 20" stroke="var(--color-ma20)" dot={dots} strokeWidth={1.25} connectNulls isAnimationActive={false} /> : null}
      {mode === "ma" ? <Line yAxisId="p" type="monotone" dataKey="ma40" name="MA 40" stroke="var(--color-ma40)" dot={dots} strokeWidth={1.25} connectNulls isAnimationActive={false} /> : null}
      {mode === "ma" ? <Line yAxisId="p" type="monotone" dataKey="ma100" name="MA 100" stroke="var(--color-ma100)" dot={dots} strokeWidth={1.25} connectNulls isAnimationActive={false} /> : null}
      {mode === "ma" ? <Line yAxisId="p" type="monotone" dataKey="ma200" name="MA 200" stroke="var(--color-ma200)" dot={dots} strokeWidth={1.25} connectNulls isAnimationActive={false} /> : null}
      {athNear ? levelLine("ath", levels.ath, TC.ath, { width: 1.5 }) : null}
      {levelLine("open", levels.lastOpen, TC.open, { dash: "7 5", width: 1.5 })}
      {levelLine("close", levels.lastClose, TC.close, { dash: "7 5", width: 1.5 })}
      <Customized component={(chart: Record<string, unknown>) => <TagStack {...chart} axisId="p" tags={tags} />} />
      {levels.ath != null && !athNear ? <AthOffscreen value={levels.ath} x={width - 74} /> : null}
    </ComposedChart>
  );
}

function AthOffscreen({ value, x }: { value: number; x: number }) {
  return (
    <text x={x} y={14} textAnchor="end" fontSize={11} fill={TC.ath} fontFamily="IBM Plex Mono, monospace">
      ▲ Máx. histórico {price(value)} (fuera de escala)
    </text>
  );
}

function WordenChart({ points, width, height }: { points: OverlayPoint[]; width?: number; height?: number }) {
  const maxVol = points.reduce((max, point) => Math.max(max, point.volume), 1);
  if (!width || !height) return null;
  const last = points[points.length - 1]?.worden ?? null;
  return (
    <ComposedChart width={width} height={height} data={points} margin={{ top: 22, right: 0, left: 6, bottom: 0 }}>
      <CartesianGrid stroke={TC.grid} strokeWidth={1} />
      <XAxis dataKey="t" tickFormatter={axisTick} tick={{ fill: TC.axis, fontSize: 11 }} axisLine={{ stroke: TC.grid }} tickLine={false} minTickGap={36} />
      <YAxis yAxisId="w" orientation="right" domain={[0, 100]} ticks={[20, 50, 80]} tick={{ fill: TC.axis, fontSize: 11 }} axisLine={{ stroke: TC.grid }} tickLine={false} width={66} />
      <YAxis yAxisId="v" hide domain={[0, 1]} />
      <Tooltip content={<OhlcTip mode="worden" />} />
      <Bar
        yAxisId="v"
        dataKey="volume"
        isAnimationActive={false}
        legendType="none"
        shape={(raw: unknown) => <VolumeMark {...(raw as MarkProps)} maxVol={maxVol} />}
      />
      <ReferenceLine yAxisId="w" y={80} stroke={TC.down} strokeOpacity={0.7} strokeDasharray="6 5" />
      <ReferenceLine yAxisId="w" y={50} stroke={TC.last} strokeDasharray="2 4" />
      <ReferenceLine yAxisId="w" y={20} stroke={TC.up} strokeOpacity={0.7} strokeDasharray="6 5" />
      <Line yAxisId="w" type="monotone" dataKey="worden" name="Worden" stroke={TC.band} dot={false} strokeWidth={1.5} connectNulls isAnimationActive={false} />
      {last != null ? (
        <ReferenceLine
          yAxisId="w"
          y={last}
          stroke="none"
          label={(props: { viewBox?: { x?: number; y?: number; width?: number } }) => (
            <g>
              <rect x={(props.viewBox?.x ?? 0) + (props.viewBox?.width ?? 0) + 1} y={(props.viewBox?.y ?? 0) - 8} width={40} height={16} rx={2} fill={TC.band} />
              <text x={(props.viewBox?.x ?? 0) + (props.viewBox?.width ?? 0) + 5} y={(props.viewBox?.y ?? 0) + 4} fontSize={11} fontFamily="IBM Plex Mono, monospace" fill="#000">
                {last.toFixed(1)}
              </text>
            </g>
          )}
        />
      ) : null}
    </ComposedChart>
  );
}

function CandleMark({ x = 0, width = 0, payload, background, domain }: MarkProps & { domain: [number, number] }) {
  if (!payload || !background?.height) return <g />;
  const top = background.y ?? 0;
  const span = domain[1] - domain[0] || 1;
  const yOf = (value: number) => top + ((domain[1] - value) / span) * (background.height as number);
  const bodyW = Math.max(1.5, Math.min(12, width * 0.62));
  const cx = x + width / 2;
  const up = payload.close >= payload.open;
  const color = up ? TC.up : TC.down;
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
      fill={up ? TC.up : TC.down}
      opacity={0.45}
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
    <div className="rounded-md border border-[#333] bg-black/90 px-2.5 py-2 text-xs text-[#e5e5e5]">
      <p className="mb-1 font-mono text-muted">{row.t}</p>
      {mode === "worden" ? (
        <p>Worden {row.worden == null ? "—" : row.worden.toFixed(1)}</p>
      ) : (
        <>
          <p style={{ color: up ? TC.up : TC.down }}>
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
  identity,
  onZoom,
  total,
  count,
  setCount,
}: {
  children: ReactElement;
  pending: boolean;
  height: string;
  badge: string;
  label: string;
  identity?: ChartIdentity;
  onZoom: () => void;
  total: number;
  count: number;
  setCount: (n: number) => void;
}) {
  const ref = useWheelZoom(total, count, setCount);
  return (
    <div
      ref={ref}
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
      <ChartBox pending={pending} height={height} badge={badge} identity={identity}>
        {children}
      </ChartBox>
    </div>
  );
}

export function WheelBox({
  total,
  count,
  setCount,
  children,
}: {
  total: number;
  count: number;
  setCount: (n: number) => void;
  children: ReactNode;
}) {
  const ref = useWheelZoom(total, count, setCount);
  return <div ref={ref}>{children}</div>;
}

function ChartBox({
  children,
  pending,
  height,
  badge,
  identity,
}: {
  children: ReactElement;
  pending: boolean;
  height: string;
  badge: string;
  identity?: ChartIdentity;
}) {
  return (
    <div
      className={`relative overflow-hidden rounded-md border border-[#1c1c1c] ${height} ${pending ? "opacity-50" : ""}`}
      style={{ background: TC.bg }}
    >
      {identity ? <Watermark identity={identity} /> : null}
      <TimeBadge label={badge} />
      <div className="relative z-[1] h-full w-full">
        <ResponsiveContainer width="100%" height="100%">
          {children}
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/** Marca de agua centrada, como TC2000: ticker grande y debajo empresa, sector e industria. */
export function Watermark({ identity }: { identity: ChartIdentity }) {
  const lines = [identity.name, identity.sector, identity.industry].filter(Boolean) as string[];
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-0 flex flex-col items-center justify-center pr-14 text-center select-none"
      style={{ color: TC.watermark }}
    >
      <span className="text-[clamp(2.5rem,9vw,5.5rem)] leading-none font-medium tracking-tight">{identity.ticker}</span>
      {lines.map((line, i) => (
        <span key={line} className={i === 0 ? "mt-1 text-[clamp(1.1rem,3.6vw,2.25rem)] leading-tight" : "text-[clamp(0.85rem,2.4vw,1.35rem)] leading-snug"}>
          {line}
        </span>
      ))}
    </div>
  );
}

function TimeBadge({ label }: { label: string }) {
  return (
    <span className="pointer-events-none absolute top-1 left-2 z-10 max-w-[70%] truncate rounded px-1.5 py-0.5 font-mono text-[11px] text-[#a3a3a3]">
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
