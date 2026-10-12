import { Link } from "@tanstack/react-router";

const tabs = [
  { to: "/", label: "Rango óptimo" },
  { to: "/mesa", label: "Mesa de indicadores" },
] as const;

export function AppNav() {
  return (
    <nav aria-label="Secciones" className="border-b border-line bg-surface/80">
      <div className="mx-auto flex w-full max-w-[1560px] gap-1 overflow-x-auto px-4 sm:px-6">
        {tabs.map((t) => (
          <Link
            key={t.to}
            to={t.to}
            activeOptions={{ exact: true, includeSearch: false }}
            className="min-h-12 shrink-0 border-b-2 border-transparent px-3 py-3 text-sm whitespace-nowrap text-muted hover:text-fg"
            activeProps={{ className: "border-call! text-fg font-medium" }}
          >
            {t.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}
