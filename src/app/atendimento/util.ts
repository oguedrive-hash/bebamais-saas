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

/**
 * Cor de cada situação do cliente, igual na lista e na conversa:
 * vermelho = esperando · verde = comigo · azul = com o assistente ·
 * roxo = com outra atendente (ou pelo celular) · cinza = finalizada.
 * Classes escritas por extenso para o Tailwind encontrar.
 */
export type Situacao = "esperando" | "minha" | "assistente" | "outra" | "finalizada";

export const COR_SITUACAO: Record<Situacao, { rotulo: string; barra: string; chip: string; cabecalho: string }> = {
  esperando: { rotulo: "Esperando", barra: "border-l-red-600", chip: "bg-red-100 text-red-800", cabecalho: "bg-red-50 text-red-900" },
  minha: { rotulo: "Com você", barra: "border-l-green-600", chip: "bg-green-100 text-green-800", cabecalho: "bg-green-50 text-green-900" },
  assistente: { rotulo: "Com o assistente", barra: "border-l-blue-500", chip: "bg-blue-100 text-blue-800", cabecalho: "bg-blue-50 text-blue-900" },
  outra: { rotulo: "Com outra atendente", barra: "border-l-violet-500", chip: "bg-violet-100 text-violet-800", cabecalho: "bg-violet-50 text-violet-900" },
  finalizada: { rotulo: "Finalizada", barra: "border-l-stone-300", chip: "bg-stone-200 text-stone-700", cabecalho: "bg-stone-100 text-stone-700" },
};

export function situacaoDe(c: { status: string; atribuidoA: string | null }, usuarioId: string): Situacao {
  if (c.status === "aguardando") return "esperando";
  if (c.status === "bot") return "assistente";
  if (c.status === "atendendo") return c.atribuidoA === usuarioId ? "minha" : "outra";
  return "finalizada";
}

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
