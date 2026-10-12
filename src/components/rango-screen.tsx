import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Eye, Loader2, X } from "lucide-react";
import { getRango, getTickers } from "@/lib/market/rango.functions";
import type { RangoRow, TickerItem } from "@/lib/market/rango.server";
import { analyzeTicker } from "@/lib/market/analyze.functions";
import type { Analysis, SideRange } from "@/lib/market/types";
import { DeskDetail, DeskTable } from "@/components/ticker-desk";
import { AdOverlay } from "@/components/ad-overlay";

const FAV_KEY = "rangoOpciones.favoritos";
const UNLIMITED_KEY = "rangoOpciones.favoritosIlimitados";
const MAX_FAVORITES = 3;

function readStore(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStore(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* sin almacenamiento: la app sigue sin favoritos guardados */
  }
}

function unlimited(): boolean {
  return readStore(UNLIMITED_KEY) === "1";
}

function maxFavorites(): number {
  return unlimited() ? Infinity : MAX_FAVORITES;
}

function loadFavorites(): string[] {
  try {
    const arr = JSON.parse(readStore(FAV_KEY) ?? "[]");
    if (!Array.isArray(arr)) return [];
    const max = maxFavorites();
    return Number.isFinite(max) ? arr.slice(0, max) : arr.slice();
  } catch {
    return [];
  }
}

function saveFavorites(arr: string[]) {
  const max = maxFavorites();
  writeStore(FAV_KEY, JSON.stringify(Number.isFinite(max) ? arr.slice(0, max) : arr));
}

function fmtRange(r: SideRange | null): string {
  if (!r) return "—";
  return `$${r.desde.toLocaleString("en-US")} – $${r.hasta.toLocaleString("en-US")}`;
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("es-ES", { year: "numeric", month: "2-digit", day: "2-digit" });
}

function recomClass(v: string | null): string {
  if (v == null) return "text-muted";
  const n = Number.parseFloat(v);
  if (Number.isNaN(n)) return "text-fg";
  return n >= 2 && n <= 3 ? "text-up" : "text-down";
}

type Detail = { symbol: string; side: "call" | "put"; range: SideRange; fecha: string };

export function RangoScreen() {
  const [tickers, setTickers] = useState<TickerItem[]>([]);
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [status, setStatus] = useState<{ msg: string; err?: boolean }>({ msg: "" });
  const [rows, setRows] = useState<RangoRow[]>([]);
  const [favs, setFavs] = useState<string[]>([]);
  const [isUnlimited, setUnlimited] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [desk, setDesk] = useState<RangoRow | null>(null);
  const queue = useRef(Promise.resolve());

  const filtered = useMemo(() => {
    const q = query.trim().toUpperCase();
    if (!q) return [];
    return tickers.filter((t) => t.symbol.startsWith(q)).slice(0, 60);
  }, [query, tickers]);

  const selectTicker = useCallback((symbol: string) => {
    setQuery(symbol);
    setFocused(false);
    // de a uno: el motor de rango consulta muchos contratos por acción
    queue.current = queue.current.then(async () => {
      setBusy(symbol);
      setStatus({ msg: `Calculando rango para ${symbol}…` });
      try {
        const data = await getRango({ data: { ticker: symbol } });
        if (data.omitida) {
          setRows((prev) => prev.filter((r) => r.accion !== symbol));
          setStatus({ msg: data.motivo, err: true });
          return;
        }
        setRows((prev) => [data, ...prev.filter((r) => r.accion !== data.accion)]);
        setStatus({
          msg: `Listo — ${symbol} (vencimiento usado: ${data.vencimientoUsado ?? "—"}, precio actual $${data.spot ?? "—"}).`,
        });
      } catch (err) {
        setStatus({ msg: `Error con ${symbol}: ${err instanceof Error ? err.message : "no se pudo calcular"}`, err: true });
      } finally {
        setBusy(null);
      }
    });
  }, []);

  useEffect(() => {
    // ?favoritos=ilimitados quita el límite de 3 en este equipo
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get("favoritos") === "ilimitados") {
        writeStore(UNLIMITED_KEY, "1");
        params.delete("favoritos");
        const q = params.toString();
        window.history.replaceState({}, "", window.location.pathname + (q ? `?${q}` : "") + window.location.hash);
      }
    } catch {
      /* sin URL o almacenamiento */
    }
    setUnlimited(unlimited());
    const initial = loadFavorites();
    setFavs(initial);

    setStatus({ msg: "Cargando listado de acciones (NYSE + NASDAQ)…" });
    getTickers()
      .then((list) => {
        setTickers(list);
        setStatus((s) => (s.msg.startsWith("Cargando listado") ? { msg: `${list.length} acciones (NYSE + NASDAQ) cargadas. Escribe para buscar.` } : s));
      })
      .catch((err) => setStatus({ msg: `No se pudo cargar el listado de acciones: ${err instanceof Error ? err.message : ""}`, err: true }));

    for (const s of initial) selectTicker(s);
  }, [selectTicker]);

  function toggleFavorite(symbol: string) {
    const current = loadFavorites();
    const idx = current.indexOf(symbol);
    if (idx >= 0) {
      current.splice(idx, 1);
      saveFavorites(current);
      setFavs(current);
      setStatus({ msg: `${symbol} se quitó de favoritos.` });
      return;
    }
    const max = maxFavorites();
    if (current.length >= max) {
      setStatus({ msg: `Ya tenés ${max} favoritos, el máximo por equipo. Quitá uno antes de agregar otro.`, err: true });
      return;
    }
    current.push(symbol);
    saveFavorites(current);
    setFavs(current);
    setStatus({ msg: `${symbol} se marcó como favorito — se va a cargar solo automáticamente cada vez que abras la página en este equipo.` });
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!filtered.length) {
      if (e.key === "Enter" && /^[A-Za-z][A-Za-z0-9.-]{0,9}$/.test(query.trim())) {
        e.preventDefault();
        selectTicker(query.trim().toUpperCase());
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      selectTicker(filtered[Math.max(activeIndex, 0)].symbol);
    } else if (e.key === "Escape") {
      setFocused(false);
    }
  }

  const listOpen = focused && filtered.length > 0;

  return (
    <main className="mx-auto w-full max-w-[1560px] px-4 py-6 sm:px-6 sm:py-8">
      <AdOverlay />
      <header className="mb-6 max-w-3xl">
        <p className="font-mono text-xs tracking-widest text-call uppercase">NYSE · NASDAQ</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-fg">Rango óptimo de precios para opciones</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          Selecciona una acción (NYSE o NASDAQ). Se calcula, con la cadena de opciones del vencimiento más cercano en
          Yahoo Finance, el rango óptimo de precio por contrato (× 100 acciones) para calls y para puts. Con el ojo de
          cada fila abres todo lo de esa acción en la Mesa de indicadores.
        </p>
      </header>

      <section className="mb-4 rounded-lg border border-line bg-surface p-4">
        <label htmlFor="tickerInput" className="mb-2 block text-sm text-muted">
          Acción
        </label>
        <div className="relative max-w-md">
          <input
            id="tickerInput"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value.toUpperCase());
              setActiveIndex(0);
            }}
            onFocus={() => setFocused(true)}
            onBlur={() => window.setTimeout(() => setFocused(false), 120)}
            onKeyDown={onKeyDown}
            placeholder="Escribe para buscar… ej. AAPL, META"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            role="combobox"
            aria-expanded={listOpen}
            aria-controls="comboList"
            className="h-12 w-full rounded-lg border border-line bg-inset px-3 font-mono text-base text-fg outline-none focus:border-call"
          />
          {listOpen ? (
            <ul
              id="comboList"
              role="listbox"
              className="absolute top-[calc(100%+4px)] z-30 max-h-80 w-full overflow-y-auto rounded-lg border border-line bg-inset shadow-xl"
            >
              {filtered.map((t, i) => (
                <li key={t.symbol} role="option" aria-selected={i === activeIndex}>
                  <button
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      selectTicker(t.symbol);
                    }}
                    className={`flex w-full items-baseline gap-3 px-3 py-2 text-left text-sm ${i === activeIndex ? "bg-surface" : "hover:bg-surface"}`}
                  >
                    <span className="w-16 shrink-0 font-mono font-medium text-fg">{t.symbol}</span>
                    <span className="truncate text-muted">
                      {t.name}
                      {t.exchange ? ` · ${t.exchange}` : ""}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        <p className={`mt-3 min-h-5 text-sm ${status.err ? "text-down" : "text-muted"}`} role="status">
          {busy ? <Loader2 className="mr-1.5 inline size-3.5 animate-spin" aria-hidden="true" /> : null}
          {status.msg}
        </p>
      </section>

      <section className="mb-4 rounded-lg border border-line bg-surface p-4">
        <p className="mb-2 text-sm text-muted">
          Favoritos en este equipo ({isUnlimited ? "sin límite en este equipo" : `máx. ${MAX_FAVORITES}`})
        </p>
        {favs.length ? (
          <div className="flex flex-wrap gap-2">
            {favs.map((s) => (
              <span key={s} className="inline-flex items-center overflow-hidden rounded-full border border-line bg-inset">
                <button
                  type="button"
                  onClick={() => selectTicker(s)}
                  title={`Calcular rango para ${s}`}
                  className="min-h-9 px-3 font-mono text-sm text-fg hover:text-call"
                >
                  {s}
                </button>
                <button
                  type="button"
                  onClick={() => toggleFavorite(s)}
                  aria-label={`Quitar ${s} de favoritos`}
                  className="grid min-h-9 w-8 place-items-center border-l border-line text-muted hover:text-down"
                >
                  <X className="size-3.5" aria-hidden="true" />
                </button>
              </span>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted">Todavía no marcaste ninguna acción como favorita.</p>
        )}
      </section>

      <section className="rounded-lg border border-line bg-surface">
        <div className="overflow-x-auto overscroll-x-contain">
          <table className="w-full min-w-[1080px] border-collapse text-left text-sm">
            <thead>
              <tr className="text-xs tracking-wide text-muted uppercase">
                <th className="w-12 px-2 py-3 text-center font-medium" title="Abrir en la Mesa de indicadores">
                  <Eye className="mx-auto size-4" aria-label="Mesa" />
                </th>
                <th className="w-10 px-1 py-3 text-center font-medium">★</th>
                <th className="px-3 py-3 font-medium">Acción</th>
                <th className="px-3 py-3 font-medium">Índice</th>
                <th className="px-3 py-3 font-medium whitespace-nowrap">Fecha de rango</th>
                <th className="px-3 py-3 font-medium whitespace-nowrap">Rango para call</th>
                <th className="px-3 py-3 font-medium whitespace-nowrap">Rango para put</th>
                <th className="px-3 py-3 font-medium whitespace-nowrap">Market Cap</th>
                <th className="px-3 py-3 font-medium">IPO</th>
                <th className="px-3 py-3 font-medium">Recom</th>
                <th className="px-3 py-3 text-right font-medium whitespace-nowrap">Target Price</th>
                <th className="px-3 py-3 text-right font-medium">Price</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const fav = favs.includes(r.accion);
                return (
                  <tr key={r.accion} className="border-t border-line hover:bg-inset/60">
                    <td className="px-2 py-2 text-center">
                      <button
                        type="button"
                        onClick={() => setDesk(r)}
                        title={`Ver todo lo de ${r.accion} en la Mesa de indicadores`}
                        aria-label={`Abrir ${r.accion} en la Mesa de indicadores`}
                        className="grid size-10 place-items-center rounded-lg border border-call/40 text-call hover:bg-call/10"
                      >
                        <Eye className="size-4" aria-hidden="true" />
                      </button>
                    </td>
                    <td className="px-1 py-2 text-center">
                      <button
                        type="button"
                        onClick={() => toggleFavorite(r.accion)}
                        title={fav ? "Quitar de favoritos" : "Marcar como favorito"}
                        aria-label={fav ? `Quitar ${r.accion} de favoritos` : `Marcar ${r.accion} como favorito`}
                        aria-pressed={fav}
                        className={`grid size-10 place-items-center text-xl ${fav ? "text-put" : "text-muted hover:text-put"}`}
                      >
                        {fav ? "★" : "☆"}
                      </button>
                    </td>
                    <td className="px-3 py-2 font-mono font-semibold whitespace-nowrap">{r.accion}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-muted">{r.indice ?? "—"}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{fmtDate(r.fechaCalculada)}</td>
                    <RangeCell range={r.rangoCall} tone="call" onOpen={() => r.rangoCall && setDetail({ symbol: r.accion, side: "call", range: r.rangoCall, fecha: r.fechaCalculada })} />
                    <RangeCell range={r.rangoPut} tone="put" onOpen={() => r.rangoPut && setDetail({ symbol: r.accion, side: "put", range: r.rangoPut, fecha: r.fechaCalculada })} />
                    <td className="px-3 py-2 font-mono whitespace-nowrap">{r.marketCap ?? "—"}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-muted">{r.ipo ?? "—"}</td>
                    <td className={`px-3 py-2 font-mono whitespace-nowrap ${recomClass(r.recom)}`}>{r.recom ?? "—"}</td>
                    <td className="px-3 py-2 text-right font-mono whitespace-nowrap">{r.targetPrice ?? "—"}</td>
                    <td className="px-3 py-2 text-right font-mono whitespace-nowrap">{r.precio ?? "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {!rows.length ? (
          <p className="px-4 py-10 text-center text-sm text-muted">Todavía no has seleccionado ninguna acción.</p>
        ) : null}
      </section>

      <footer className="mt-8 border-t border-line pt-4 text-xs leading-relaxed text-muted">
        Datos de opciones vía Yahoo Finance (con ~15 min de retraso); listado de tickers vía NASDAQ Trader. Herramienta
        experimental / educativa — no es asesoría financiera ni una recomendación de inversión. Los endpoints de datos
        son no oficiales y pueden fallar o cambiar sin aviso. Los favoritos se guardan solo en este navegador/equipo (no se
        sincronizan entre dispositivos ni requieren cuenta).
      </footer>

      {detail ? <ContractsModal detail={detail} onClose={() => setDetail(null)} /> : null}
      {desk ? <DeskSheet rango={desk} onClose={() => setDesk(null)} /> : null}
    </main>
  );
}

function RangeCell({ range, tone, onOpen }: { range: SideRange | null; tone: "call" | "put"; onOpen: () => void }) {
  const color = tone === "call" ? "text-call" : "text-put";
  return (
    <td className={`px-3 py-2 font-mono whitespace-nowrap ${color}`}>
      {fmtRange(range)}
      {range && range.detalle?.length >= 2 ? (
        <button
          type="button"
          onClick={onOpen}
          title="Ver los contratos usados para calcular este rango"
          aria-label={`Ver contratos del rango ${tone}`}
          className="ml-1.5 inline-grid size-8 place-items-center rounded-md align-middle text-muted hover:bg-inset hover:text-fg"
        >
          <span aria-hidden="true">👁</span>
        </button>
      ) : null}
    </td>
  );
}

function useEscape(onClose: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
}

function ContractsModal({ detail, onClose }: { detail: Detail; onClose: () => void }) {
  useEscape(onClose);
  const { symbol, side, range, fecha } = detail;
  return (
    <div className="fixed inset-0 z-[65] flex items-end justify-center bg-black/70 p-2 sm:items-center sm:p-6" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Contratos del rango ${side} de ${symbol}`}
        className="w-full max-w-xl rounded-lg border border-line bg-surface p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-base font-semibold text-fg">
            {symbol} — datos del rango para {side} ({fmtRange(range)})
          </h3>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="grid size-10 shrink-0 place-items-center rounded-lg text-muted hover:bg-inset">
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
        <p className="mt-1 text-sm text-muted">Fecha de cálculo: {fmtDate(fecha)}</p>
        <p className="mt-2 text-xs text-muted">
          <span className="mr-1.5 inline-block size-2.5 rounded-sm bg-call/40 align-middle" />
          Los contratos resaltados son los dos que se usaron para calcular el rango.
        </p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted uppercase">
                <th className="py-1.5 font-medium">Strike</th>
                <th className="py-1.5 font-medium">Precio final</th>
                <th className="py-1.5 font-medium">Precio mínimo</th>
                <th className="py-1.5 font-medium">Precio máximo</th>
                <th className="py-1.5 font-medium">%</th>
              </tr>
            </thead>
            <tbody>
              {range.detalle.map((row, i) => (
                <tr key={`${row.strike}-${i}`} className={i < 2 ? "bg-call/15 text-fg" : "text-muted"}>
                  <td className="px-1 py-1.5 font-mono">{row.strike}</td>
                  <td className="px-1 py-1.5 font-mono">${(row.price * 100).toFixed(2)}</td>
                  <td className="px-1 py-1.5 font-mono">${(row.minimo * 100).toFixed(2)}</td>
                  <td className="px-1 py-1.5 font-mono">${(row.maximo * 100).toFixed(2)}</td>
                  <td className="px-1 py-1.5 font-mono">{row.ratio}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/** Ventana con todo lo de la Mesa de indicadores para una acción del reporte. */
function DeskSheet({ rango, onClose }: { rango: RangoRow; onClose: () => void }) {
  useEscape(onClose);
  const [row, setRow] = useState<Analysis | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    analyzeTicker({ data: { ticker: rango.accion } })
      .then((a) => {
        if (!alive) return;
        // el rango del reporte manda, así la mesa muestra los mismos números
        setRow({
          ...a,
          call: rango.rangoCall ?? a.call,
          put: rango.rangoPut ?? a.put,
          expiration: rango.vencimientoUsado ?? a.expiration,
          note: "Rango call/put: el mismo del reporte de Rango óptimo (contratos con último ≥ $0.30, igual número ITM y OTM, relación máximo/mínimo del día; prima × 100 redondeada de 5 en 5).",
        });
      })
      .catch((err) => alive && setError(err instanceof Error ? err.message : "No se pudo leer el ticker."));
    return () => {
      alive = false;
      document.body.style.overflow = prev;
    };
  }, [rango]);

  return (
    <div className="fixed inset-0 z-[60] flex justify-center bg-black/70 sm:p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Mesa de indicadores de ${rango.accion}`}
        className="flex h-full w-full max-w-6xl flex-col overflow-hidden border-line bg-bg sm:rounded-lg sm:border"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-line bg-surface px-4 py-3">
          <div className="min-w-0">
            <p className="font-mono text-xs tracking-widest text-call uppercase">Mesa de indicadores</p>
            <h2 className="truncate font-mono text-lg text-fg">{rango.accion}</h2>
          </div>
          <div className="flex items-center gap-2">
            <a
              href={`/mesa?t=${encodeURIComponent(rango.accion)}`}
              className="hidden min-h-10 items-center rounded-lg border border-line px-3 text-sm text-muted hover:text-fg sm:inline-flex"
            >
              Abrir en página completa
            </a>
            <button type="button" onClick={onClose} aria-label="Cerrar" className="grid size-10 place-items-center rounded-lg text-muted hover:bg-inset hover:text-fg">
              <X className="size-5" aria-hidden="true" />
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto overscroll-contain px-3 py-4 sm:px-6">
          {error ? (
            <p className="rounded-lg border border-down/40 bg-surface px-3 py-2 text-sm text-down" role="alert">
              {error}
            </p>
          ) : !row ? (
            <p className="flex items-center justify-center gap-2 py-24 text-sm text-muted">
              <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Leyendo fuentes de {rango.accion}…
            </p>
          ) : (
            <>
              <DeskTable rows={[row]} selected={row} />
              <DeskDetail row={row} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
