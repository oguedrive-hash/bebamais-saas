"use client";

import { useEffect, useState } from "react";
import type { Assunto } from "@/lib/atendimento/regras";

export const ROTULO_ASSUNTO: Record<Assunto, string> = {
  pedido: "Pedido",
  orcamento: "Orçamento",
  duvida: "Dúvida",
  pos_venda: "Pós-venda",
  outro: "Outro",
};

/** Relógio que atualiza sozinho (para o "esperando há X min" andar). */
export function useAgora(intervaloMs = 20000): number {
  const [agora, setAgora] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setAgora(Date.now()), intervaloMs);
    return () => clearInterval(t);
  }, [intervaloMs]);
  return agora;
}

/** "agora", "4 min", "1 h 10 min", "ontem", "12/10". */
export function tempoDesde(iso: string, agora: number): string {
  const diffMin = Math.max(0, Math.floor((agora - new Date(iso).getTime()) / 60000));
  if (diffMin < 1) return "agora";
  if (diffMin < 60) return `${diffMin} min`;
  if (diffMin < 24 * 60) {
    const h = Math.floor(diffMin / 60);
    const m = diffMin % 60;
    return m ? `${h} h ${m} min` : `${h} h`;
  }
  if (diffMin < 48 * 60) return "ontem";
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

export function horaCurta(iso: string): string {
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });
}

export function dataCurta(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "America/Sao_Paulo" });
}
