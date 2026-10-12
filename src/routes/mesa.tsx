import { createFileRoute } from "@tanstack/react-router";
import { TickerDesk } from "@/components/ticker-desk";

export const Route = createFileRoute("/mesa")({
  validateSearch: (search: Record<string, unknown>): { t?: string } => {
    const t = typeof search.t === "string" ? search.t.trim().toUpperCase() : "";
    return /^[A-Z][A-Z0-9.-]{0,9}$/.test(t) ? { t } : {};
  },
  component: Mesa,
});

function Mesa() {
  const { t } = Route.useSearch();
  return <TickerDesk key={t ?? ""} initialTicker={t} />;
}
