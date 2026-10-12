import { createServerFn } from "@tanstack/react-start";
import { fetchRango, fetchTickers } from "./rango.server";

export const getRango = createServerFn({ method: "POST" })
  .validator((data: unknown) => {
    const ticker =
      typeof data === "object" && data && "ticker" in data ? String(data.ticker) : "";
    const clean = ticker.trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9.^=-]{0,11}$/.test(clean)) throw new Error("Ticker inválido.");
    return { ticker: clean };
  })
  .handler(async ({ data }) => fetchRango(data.ticker));

export const getTickers = createServerFn({ method: "GET" }).handler(async () => fetchTickers());
