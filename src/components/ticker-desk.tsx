import { useCallback, useState, type FormEvent } from "react";
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Search } from "lucide-react";
import { ChartLightbox, Studies } from "@/components/studies";
import { analyzeTicker } from "@/lib/market/analyze.functions";
import type { Analysis, SideRange } from "@/lib/market/types";
import { rsiZone } from "@/lib/market/math";

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function money(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  return usd.format(n);
}

function rangeLabel(side: SideRange | null): string {
  if (!side) return "—";
  return `$${side.desde.toLocaleString("en-US")} – $${side.hasta.toLocaleString("en-US")}`;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("es-MX", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function sectorLine(row: Analysis): string {
  const parts = [row.sector, row.industry].filter(Boolean);
  return parts.length ? parts.join(" · ") : "—";
}

function priceClass(price: number, previous: number | null): string {
  if (previous != null && price > previous) return "text-up";
  return "text-fg";
}

function recomClass(value: number | null): string {
  if (value == null) return "text-muted";
  if (value <= 2.5) return "text-up";
  if (value <= 3.5) return "text-put";
  return "text-down";
}

function tickLabel(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${d}/${m}`;
}

export function TickerDesk() {
  const [query, setQuery] = useState("QQQI");
  const [rows, setRows] = useState<Analysis[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selected = rows.find((r) => r.ticker === active) ?? rows[0] ?? null;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const ticker = query.trim().toUpperCase();
    if (!ticker || pending) return;
    setPending(true);
    setError(null);
    try {
      const result = await analyzeTicker({ data: { ticker } });
      setRows((prev) => [result, ...prev.filter((r) => r.ticker !== result.ticker)].slice(0, 8));
      setActive(result.ticker);
      setQuery(result.ticker);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo leer el ticker.");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 sm:py-10">
      <header className="mb-6 max-w-3xl">
        <p className="font-mono text-xs tracking-widest text-call uppercase">NYSE · NASDAQ</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-fg">Mesa de indicadores</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          Escribe un ticker. La mesa arma precio, máximo y mínimo de 52 semanas, RSI, VWAP y MACD,
          más índice, sector, target y recomendación. El rango de call y put usa el vencimiento más
          cercano, igual que en tu calculadora.
        </p>
      </header>

      <form onSubmit={onSubmit} className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end">
        <label className="block flex-1">
          <span className="mb-1.5 block text-sm text-muted">Ticker</span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value.toUpperCase())}
            placeholder="QQQI"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            className="h-12 w-full rounded-lg border border-line bg-inset px-3 font-mono text-base text-fg outline-none focus:border-call"
          />
        </label>
        <button
          type="submit"
          disabled={pending}
          className="inline-flex h-12 items-center justify-center gap-2 rounded-lg bg-call px-5 font-medium text-bg disabled:opacity-60"
        >
          <Search className="size-4" aria-hidden="true" />
          {pending ? "Leyendo fuentes…" : "Analizar"}
        </button>
      </form>

      {error ? (
        <p className="mb-4 rounded-lg border border-down/40 bg-surface px-3 py-2 text-sm text-down" role="alert">
          {error}
        </p>
      ) : null}

      {!selected && !pending ? (
        <p className="rounded-lg border border-dashed border-line px-4 py-10 text-center text-sm text-muted">
          Todavía no hay un ticker en la mesa. Prueba con QQQI o AAPL.
        </p>
      ) : null}

      {selected ? (
        <>
          <section className="overflow-hidden rounded-lg border border-line bg-surface">
            <div className="flex items-baseline justify-between gap-3 border-b border-line px-4 py-3">
              <div>
                <h2 className="font-mono text-lg text-fg">{selected.ticker}</h2>
                <p className="text-sm text-muted">{selected.name}</p>
              </div>
              <p className={`text-right font-mono text-xl ${priceClass(selected.price, selected.previousClose)}`}>
                {money(selected.price)}
              </p>
            </div>
            <div className="overflow-x-auto overscroll-x-contain">
              <table className="w-full min-w-[860px] border-collapse text-left text-sm">
                <thead>
                  <tr className="text-xs tracking-wide text-muted uppercase">
                    {[
                      "Ticker",
                      "Índices",
                      "Sector",
                      "Máx. anual",
                      "Mín. anual",
                      "Precio",
                      "RSI",
                      "VWAP",
                      "MACD",
                      "Target",
                      "Recom",
                      "Fecha de cierre",
                      "Rango call",
                      "Rango put",
                    ].map((label) => (
                      <th key={label} className="px-3 py-2 font-medium whitespace-nowrap">
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const on = row.ticker === selected.ticker;
                    return (
                      <tr
                        key={row.ticker}
                        onClick={() => setActive(row.ticker)}
                        className={on ? "bg-inset" : "hover:bg-inset/60"}
                      >
                        <td className="px-3 py-3 font-mono font-medium whitespace-nowrap">{row.ticker}</td>
                        <td className="px-3 py-3 whitespace-nowrap text-muted">{row.indices ?? "—"}</td>
                        <td className="max-w-48 px-3 py-3 text-muted">{sectorLine(row)}</td>
                        <td className="px-3 py-3 font-mono whitespace-nowrap">{money(row.high52)}</td>
                        <td className="px-3 py-3 font-mono whitespace-nowrap">{money(row.low52)}</td>
                        <td className={`px-3 py-3 font-mono whitespace-nowrap ${priceClass(row.price, row.previousClose)}`}>
                          {money(row.price)}
                        </td>
                        <td className="px-3 py-3 font-mono whitespace-nowrap">
                          {row.rsi == null ? "—" : row.rsi.toFixed(1)}
                        </td>
                        <td className="px-3 py-3 font-mono whitespace-nowrap">{money(row.vwap)}</td>
                        <td className="px-3 py-3 font-mono whitespace-nowrap">
                          {row.macd == null ? "—" : row.macd.toFixed(2)}
                        </td>
                        <td className="px-3 py-3 font-mono whitespace-nowrap">{money(row.targetPrice)}</td>
                        <td className={`px-3 py-3 whitespace-nowrap ${recomClass(row.recom)}`}>
                          {row.recom == null ? "—" : `${row.recom.toFixed(2)} ${row.recomLabel ?? ""}`}
                        </td>
                        <td className="px-3 py-3 whitespace-nowrap">{fmtDate(row.expiration)}</td>
                        <td className="px-3 py-3 font-mono whitespace-nowrap text-call">
                          {rangeLabel(row.call)}
                        </td>
                        <td className="px-3 py-3 font-mono whitespace-nowrap text-put">
                          {rangeLabel(row.put)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <section className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat
              label="RSI (14)"
              value={selected.rsi == null ? "—" : selected.rsi.toFixed(1)}
              hint={rsiZone(selected.rsi) ?? "Diario, método Wilder"}
            />
            <Stat
              label="VWAP de la sesión"
              value={money(selected.vwap)}
              hint={
                selected.vwap == null
                  ? "Sin volumen intradía"
                  : selected.price >= selected.vwap
                    ? "El precio cierra sobre el VWAP"
                    : "El precio cierra bajo el VWAP"
              }
            />
            <Stat
              label="MACD 12, 26, 9"
              value={selected.macd == null ? "—" : selected.macd.toFixed(2)}
              hint={
                selected.macdSignal == null
                  ? "Diario"
                  : `Señal ${selected.macdSignal.toFixed(2)} · hist ${selected.macdHist?.toFixed(2) ?? "—"}`
              }
            />
            <Stat
              label="Fecha de cierre"
              value={fmtDate(selected.expiration)}
              hint="Vencimiento usado para call y put"
            />
          </section>

          <section className="mt-4 grid gap-3 lg:grid-cols-2">
            <RangeCard title="Rango call" tone="call" side={selected.call} />
            <RangeCard title="Rango put" tone="put" side={selected.put} />
          </section>

          <p className="mt-3 text-xs leading-relaxed text-muted">{selected.note}</p>

          <section className="mt-4 grid gap-3 sm:grid-cols-3">
            <Stat
              label="Próximas utilidades"
              value={selected.calendar.earnings ?? "—"}
              hint={
                selected.calendar.earnings
                  ? selected.calendar.earningsEstimate
                    ? "Fecha estimada de resultados"
                    : "Fecha de resultados anunciada"
                  : "Sin fecha de resultados anunciada"
              }
            />
            <Stat
              label="Ex-date de dividendo"
              value={
                selected.calendar.exDividend
                  ? selected.calendar.exDividendUpcoming
                    ? selected.calendar.exDividend
                    : `${selected.calendar.exDividend}*`
                  : "—"
              }
              hint={
                selected.calendar.exDividend
                  ? selected.calendar.exDividendUpcoming
                    ? "Próximo ex-date"
                    : "* El siguiente ex-date aún no está declarado. Se muestra el último."
                  : "Sin dividendo declarado"
              }
            />
            <Stat
              label="Próxima reunión de la Fed"
              value={selected.calendar.fedLabel}
              hint={selected.calendar.fedDetail}
            />
          </section>

          <IndicatorCharts row={selected} />
          <Studies ticker={selected.ticker} initial={selected.overlay} />
        </>
      ) : null}

      <footer className="mt-10 border-t border-line pt-4 text-xs leading-relaxed text-muted">
        Precio, 52 semanas, RSI, MACD, VWAP, medias, Bollinger y Worden salen de Yahoo Finance.
        Índice, sector, target y recomendación salen de Finviz. La reunión de la Fed es el calendario
        oficial del FOMC. No es una recomendación de compra o venta.
      </footer>
    </main>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-lg border border-line bg-surface px-4 py-3">
      <p className="text-xs tracking-wide text-muted uppercase">{label}</p>
      <p className="mt-1 font-mono text-lg text-fg">{value}</p>
      <p className="mt-1 text-xs text-muted">{hint}</p>
    </div>
  );
}

function RangeCard({
  title,
  tone,
  side,
}: {
  title: string;
  tone: "call" | "put";
  side: SideRange | null;
}) {
  const color = tone === "call" ? "text-call" : "text-put";
  return (
    <div className="rounded-lg border border-line bg-surface px-4 py-3">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-sm text-muted">{title}</h3>
        <p className={`font-mono text-lg ${color}`}>{rangeLabel(side)}</p>
      </div>
      {side ? (
        <table className="mt-3 w-full text-xs">
          <thead>
            <tr className="text-left text-muted">
              <th className="py-1 font-medium">Strike</th>
              <th className="py-1 font-medium">Prima × 100</th>
              <th className="py-1 font-medium">Mín</th>
              <th className="py-1 font-medium">Máx</th>
              <th className="py-1 font-medium">Ratio</th>
            </tr>
          </thead>
          <tbody>
            {side.detalle.map((row, i) => (
              <tr key={`${row.strike}-${i}`} className={i < 2 ? "text-fg" : "text-muted"}>
                <td className="py-1 font-mono">{row.strike}</td>
                <td className="py-1 font-mono">{money(row.price * 100)}</td>
                <td className="py-1 font-mono">{money(row.minimo * 100)}</td>
                <td className="py-1 font-mono">{money(row.maximo * 100)}</td>
                <td className="py-1 font-mono">{row.ratio}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="mt-2 text-xs text-muted">No hubo dos contratos con prima de al menos $0.30.</p>
      )}
      <p className="mt-2 text-xs text-muted">Las dos primeras filas son las que arman el rango.</p>
    </div>
  );
}

function IndicatorCharts({ row }: { row: Analysis }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const data = row.chart.filter((p) => p.rsi != null);
  if (data.length < 5) return null;
  return (
    <>
      <p className="mt-4 text-xs text-muted">Toca el gráfico diario para ampliarlo.</p>
      <section
        className="mt-2 cursor-pointer rounded-lg border border-line bg-surface px-2 py-3 sm:px-4"
        role="button"
        tabIndex={0}
        aria-label="Ampliar precio, MACD y RSI"
        onClick={() => setOpen(true)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        <DailyStack data={data} tall={false} />
      </section>
      {open ? (
        <ChartLightbox title="Precio, MACD y RSI · diario" onClose={close}>
          <DailyStack data={data} tall />
        </ChartLightbox>
      ) : null}
    </>
  );
}

function DailyStack({ data, tall }: { data: Analysis["chart"]; tall: boolean }) {
  const priceH = tall ? "h-72" : "h-48";
  const oscH = tall ? "h-48" : "h-36";
  return (
    <>
      <h3 className="px-2 text-sm text-fg">Precio, MACD y RSI · diario</h3>
      <div className={`mt-2 overflow-hidden ${priceH}`}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid stroke="var(--color-line)" vertical={false} />
            <XAxis dataKey="date" tickFormatter={tickLabel} tick={{ fill: "var(--color-muted)", fontSize: 11 }} minTickGap={28} />
            <YAxis domain={["auto", "auto"]} tick={{ fill: "var(--color-muted)", fontSize: 11 }} width={48} />
            <Tooltip
              contentStyle={{ background: "var(--color-inset)", border: "1px solid var(--color-line)", borderRadius: 8 }}
              labelStyle={{ color: "var(--color-muted)" }}
              formatter={(value: number) => [money(value), "Cierre"]}
            />
            <Line type="monotone" dataKey="close" stroke="var(--color-fg)" dot={false} strokeWidth={2} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className={`overflow-hidden ${oscH}`}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid stroke="var(--color-line)" vertical={false} />
            <XAxis dataKey="date" hide />
            <YAxis tick={{ fill: "var(--color-muted)", fontSize: 11 }} width={48} />
            <ReferenceLine y={0} stroke="var(--color-line)" />
            <Tooltip
              contentStyle={{ background: "var(--color-inset)", border: "1px solid var(--color-line)", borderRadius: 8 }}
              formatter={(value: number, name: string) => [Number(value).toFixed(2), name]}
            />
            <Bar dataKey="hist" isAnimationActive={false}>
              {data.map((point) => (
                <Cell key={point.date} fill={(point.hist ?? 0) >= 0 ? "var(--color-up)" : "var(--color-down)"} />
              ))}
            </Bar>
            <Line type="monotone" dataKey="macd" name="MACD" stroke="var(--color-call)" dot={false} strokeWidth={2} isAnimationActive={false} />
            <Line type="monotone" dataKey="signal" name="Señal" stroke="var(--color-put)" dot={false} strokeWidth={1.5} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className={`overflow-hidden ${oscH}`}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid stroke="var(--color-line)" vertical={false} />
            <XAxis dataKey="date" tickFormatter={tickLabel} tick={{ fill: "var(--color-muted)", fontSize: 11 }} minTickGap={28} />
            <YAxis domain={[0, 100]} ticks={[30, 50, 70]} tick={{ fill: "var(--color-muted)", fontSize: 11 }} width={48} />
            <ReferenceLine y={70} stroke="var(--color-down)" strokeDasharray="3 3" />
            <ReferenceLine y={30} stroke="var(--color-up)" strokeDasharray="3 3" />
            <Tooltip
              contentStyle={{ background: "var(--color-inset)", border: "1px solid var(--color-line)", borderRadius: 8 }}
              formatter={(value: number) => [Number(value).toFixed(1), "RSI"]}
            />
            <Line type="monotone" dataKey="rsi" stroke="var(--color-call)" dot={false} strokeWidth={2} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </>
  );
}
