import { createFileRoute } from "@tanstack/react-router";
import { RangoScreen } from "@/components/rango-screen";

export const Route = createFileRoute("/")({ component: RangoScreen });
