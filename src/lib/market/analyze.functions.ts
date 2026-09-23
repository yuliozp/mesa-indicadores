import { createServerFn } from "@tanstack/react-start";
import { analyzeTickerData, isInterval, loadOverlaySeries } from "./analyze.server";

export const analyzeTicker = createServerFn({ method: "POST" })
  .validator((data: unknown) => {
    const ticker =
      typeof data === "object" && data && "ticker" in data ? String(data.ticker) : "";
    const clean = ticker.trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(clean)) {
      throw new Error("Escribe un ticker de 1 a 10 letras, por ejemplo QQQI o AAPL.");
    }
    return { ticker: clean };
  })
  .handler(async ({ data }) => analyzeTickerData(data.ticker));

export const getOverlay = createServerFn({ method: "POST" })
  .validator((data: unknown) => {
    const ticker =
      typeof data === "object" && data && "ticker" in data ? String(data.ticker) : "";
    const interval =
      typeof data === "object" && data && "interval" in data ? String(data.interval) : "";
    const clean = ticker.trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(clean)) {
      throw new Error("Ticker inválido.");
    }
    if (!isInterval(interval)) throw new Error("Temporalidad no reconocida.");
    return { ticker: clean, interval };
  })
  .handler(async ({ data }) => loadOverlaySeries(data.ticker, data.interval));
