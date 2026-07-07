"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Re-busca os dados da página num intervalo fixo (router.refresh) — usado na
 * fila de Pedidos, que não tem realtime: pedido novo aparecia só com F5.
 * Pausa quando a aba não está visível (não desperdiça rede/CPU).
 */
export function AutoRefresh({ ms = 30000 }: { ms?: number }) {
  const router = useRouter();
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    const id = setInterval(tick, ms);
    return () => clearInterval(id);
  }, [ms, router]);
  return null;
}
