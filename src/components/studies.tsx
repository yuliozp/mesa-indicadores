import { useEffect, useState, type ReactElement } from "react";
import {
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
import type { IntervalId, OverlaySeries } from "@/lib/market/types";

const INTERVALS: Array<{ id: IntervalId; label: string }> = [
  { id: "1m", label: "1 min" },
  { id: "5m", label: "5 min" },
  { id: "15m", label: "15 min" },
  { id: "1h", label: "1 h" },
  { id: "1d", label: "1 día" },
];

const tipStyle = {
  background: "var(--color-inset)",
  border: "1px solid var(--color-line)",
  borderRadius: 8,
};

function axisTick(t: string): string {
  if (t.length <= 10) return `${t.slice(8)}/${t.slice(5, 7)}`;
  return `${t.slice(8, 10)} ${t.slice(11, 16)}`;
}

function price(n: number): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function Studies({ ticker, initial }: { ticker: string; initial: OverlaySeries }) {
  const [interval, setInterval] = useState<IntervalId>("1d");
  const [series, setSeries] = useState<OverlaySeries>(initial);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const badge = series.label;

  return (
    <section className="mt-4 space-y-3">
      <article className="rounded-lg border border-line bg-surface px-2 py-3 sm:px-4">
        <div className="flex flex-col gap-3 px-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h3 className="text-sm text-fg">Medias móviles</h3>
            <Swatches
              items={[
                ["Precio", "var(--color-fg)"],
                ["20", "var(--color-ma20)"],
                ["40", "var(--color-ma40)"],
                ["100", "var(--color-ma100)"],
                ["200", "var(--color-ma200)"],
              ]}
            />
          </div>
          <IntervalPicker interval={interval} onChange={setInterval} />
        </div>
        {error ? <p className="px-2 pt-2 text-xs text-down">{error}</p> : null}
        <ChartBox pending={pending} height="h-56" badge={badge}>
          <ComposedChart data={series.points} margin={{ top: 18, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid stroke="var(--color-line)" vertical={false} />
            <XAxis dataKey="t" tickFormatter={axisTick} tick={{ fill: "var(--color-muted)", fontSize: 11 }} minTickGap={28} />
            <YAxis domain={["auto", "auto"]} tick={{ fill: "var(--color-muted)", fontSize: 11 }} width={52} />
            <Tooltip contentStyle={tipStyle} labelStyle={{ color: "var(--color-muted)" }} formatter={(value: number, name: string) => [price(Number(value)), name]} />
            <Line type="monotone" dataKey="close" name="Precio" stroke="var(--color-fg)" dot={false} strokeWidth={2} isAnimationActive={false} />
            <Line type="monotone" dataKey="ma20" name="MA 20" stroke="var(--color-ma20)" dot={false} strokeWidth={1.5} connectNulls isAnimationActive={false} />
            <Line type="monotone" dataKey="ma40" name="MA 40" stroke="var(--color-ma40)" dot={false} strokeWidth={1.5} connectNulls isAnimationActive={false} />
            <Line type="monotone" dataKey="ma100" name="MA 100" stroke="var(--color-ma100)" dot={false} strokeWidth={1.5} connectNulls isAnimationActive={false} />
            <Line type="monotone" dataKey="ma200" name="MA 200" stroke="var(--color-ma200)" dot={false} strokeWidth={1.5} connectNulls isAnimationActive={false} />
          </ComposedChart>
        </ChartBox>
      </article>

      <article className="rounded-lg border border-line bg-surface px-2 py-3 sm:px-4">
        <div className="flex flex-col gap-3 px-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h3 className="text-sm text-fg">Bandas de Bollinger</h3>
            <p className="mt-1 text-xs text-muted">20 periodos, ±2 desviaciones. La temporalidad es la misma que en las medias.</p>
          </div>
          <IntervalPicker interval={interval} onChange={setInterval} />
        </div>
        <ChartBox pending={pending} height="h-48" badge={badge}>
          <ComposedChart data={series.points} margin={{ top: 18, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid stroke="var(--color-line)" vertical={false} />
            <XAxis dataKey="t" tickFormatter={axisTick} tick={{ fill: "var(--color-muted)", fontSize: 11 }} minTickGap={28} />
            <YAxis domain={["auto", "auto"]} tick={{ fill: "var(--color-muted)", fontSize: 11 }} width={52} />
            <Tooltip contentStyle={tipStyle} formatter={(value: number, name: string) => [price(Number(value)), name]} />
            <Line type="monotone" dataKey="bbUpper" name="Superior" stroke="var(--color-call)" dot={false} strokeWidth={1.25} connectNulls isAnimationActive={false} />
            <Line type="monotone" dataKey="bbMid" name="Media 20" stroke="var(--color-ma20)" dot={false} strokeDasharray="4 3" connectNulls isAnimationActive={false} />
            <Line type="monotone" dataKey="bbLower" name="Inferior" stroke="var(--color-call)" dot={false} strokeWidth={1.25} connectNulls isAnimationActive={false} />
            <Line type="monotone" dataKey="close" name="Precio" stroke="var(--color-fg)" dot={false} strokeWidth={1.75} isAnimationActive={false} />
          </ComposedChart>
        </ChartBox>
      </article>

      <article className="rounded-lg border border-line bg-surface px-2 py-3 sm:px-4">
        <div className="px-2">
          <h3 className="text-sm text-fg">Worden Stochastic</h3>
          <p className="mt-1 text-xs text-muted">Percentil del cierre, periodo 14, suavizado 3. Sigue la temporalidad de las medias.</p>
        </div>
        <ChartBox pending={pending} height="h-44" badge={badge}>
          <ComposedChart data={series.points} margin={{ top: 18, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid stroke="var(--color-line)" vertical={false} />
            <XAxis dataKey="t" tickFormatter={axisTick} tick={{ fill: "var(--color-muted)", fontSize: 11 }} minTickGap={28} />
            <YAxis domain={[0, 100]} ticks={[20, 50, 80]} tick={{ fill: "var(--color-muted)", fontSize: 11 }} width={36} />
            <ReferenceLine y={80} stroke="var(--color-down)" strokeDasharray="3 3" />
            <ReferenceLine y={20} stroke="var(--color-up)" strokeDasharray="3 3" />
            <Tooltip contentStyle={tipStyle} formatter={(value: number) => [Number(value).toFixed(1), "Worden"]} />
            <Line type="monotone" dataKey="worden" name="Worden" stroke="var(--color-ma200)" dot={false} strokeWidth={2} connectNulls isAnimationActive={false} />
          </ComposedChart>
        </ChartBox>
      </article>
    </section>
  );
}

function IntervalPicker({
  interval,
  onChange,
}: {
  interval: IntervalId;
  onChange: (id: IntervalId) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="Temporalidad">
      {INTERVALS.map((item) => (
        <button
          key={item.id}
          type="button"
          aria-pressed={interval === item.id}
          onClick={() => onChange(item.id)}
          className={
            interval === item.id
              ? "h-11 rounded-lg bg-call px-3 text-sm font-medium text-bg"
              : "h-11 rounded-lg border border-line px-3 text-sm text-fg"
          }
        >
          {item.label}
        </button>
      ))}
    </div>
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
    <div className={`relative mt-2 overflow-hidden ${height} ${pending ? "opacity-50" : ""}`}>
      <TimeBadge label={badge} />
      <ResponsiveContainer width="100%" height="100%">
        {children}
      </ResponsiveContainer>
    </div>
  );
}

function TimeBadge({ label }: { label: string }) {
  return (
    <span className="pointer-events-none absolute top-1 right-2 z-10 rounded-md border border-line bg-inset px-2 py-1 font-mono text-xs text-call">
      {label}
    </span>
  );
}
