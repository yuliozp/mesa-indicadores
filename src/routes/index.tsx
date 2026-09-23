import { createFileRoute } from "@tanstack/react-router";
import { TickerDesk } from "@/components/ticker-desk";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  return <TickerDesk />;
}
