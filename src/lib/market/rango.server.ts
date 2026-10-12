import type { SideRange } from "./types";

/**
 * El rango óptimo se calcula con el mismo motor de la calculadora original
 * (precio-optimo-opciones), así los números del reporte no cambian al unir las
 * dos herramientas. La Mesa de indicadores agrega todo lo demás.
 */
const RANGO_API = process.env.RANGO_API_URL || "https://precio-optimo-opciones.vercel.app";

export type RangoRow = {
  accion: string;
  spot: number | null;
  vencimientoUsado: string | null;
  fechaCalculada: string;
  indice: string | null;
  marketCap: string | null;
  ipo: string | null;
  recom: string | null;
  targetPrice: string | null;
  precio: string | null;
  rangoCall: SideRange | null;
  rangoPut: SideRange | null;
};

export type RangoResult =
  | { omitida: true; accion: string; motivo: string }
  | ({ omitida: false } & RangoRow);

export type TickerItem = { symbol: string; name: string; exchange: string };

async function getJson(path: string, timeoutMs: number): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${RANGO_API}${path}`, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  let body: Record<string, unknown> = {};
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    /* respuesta vacía o no JSON */
  }
  return { status: res.status, body };
}

const str = (v: unknown): string | null => (v == null || v === "" ? null : String(v));

export async function fetchRango(ticker: string): Promise<RangoResult> {
  const { status, body } = await getJson(`/api/rango?ticker=${encodeURIComponent(ticker)}`, 55000);
  if (status >= 400) throw new Error(str(body.error) ?? `No se pudo calcular el rango (${status}).`);
  if (body.omitida) {
    return { omitida: true, accion: ticker, motivo: str(body.motivo) ?? `${ticker} no opera con opciones — se omite del reporte.` };
  }
  return {
    omitida: false,
    accion: str(body.accion) ?? ticker,
    spot: typeof body.spot === "number" ? body.spot : null,
    vencimientoUsado: str(body.vencimientoUsado),
    fechaCalculada: str(body.fechaCalculada) ?? new Date().toISOString(),
    indice: str(body.indice),
    marketCap: str(body.marketCap),
    ipo: str(body.ipo),
    recom: str(body.recom),
    targetPrice: str(body.targetPrice),
    precio: str(body.precio),
    rangoCall: (body.rangoCall as SideRange | null) ?? null,
    rangoPut: (body.rangoPut as SideRange | null) ?? null,
  };
}

let tickerCache: { at: number; list: TickerItem[] } | null = null;

export async function fetchTickers(): Promise<TickerItem[]> {
  if (tickerCache && Date.now() - tickerCache.at < 6 * 3600 * 1000) return tickerCache.list;
  const { status, body } = await getJson("/api/tickers", 30000);
  if (status >= 400) throw new Error(str(body.error) ?? "No se pudo cargar el listado de acciones.");
  const list = Array.isArray(body.tickers) ? (body.tickers as TickerItem[]) : [];
  tickerCache = { at: Date.now(), list };
  return list;
}
