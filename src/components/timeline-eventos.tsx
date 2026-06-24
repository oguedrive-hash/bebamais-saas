"use client";

import { useState } from "react";

type Evento = {
  id: string;
  tipo: string;
  descricao: string;
  autor_nome: string | null;
  created_at: string;
};

const ICONE_POR_TIPO: Record<string, string> = {
  status_mudou: "🔀",
  caio_toggle: "🤖",
  followup_toggle: "⏰",
  followup_enviado: "📨",
  lembrete_enviado: "🔔",
  msg_painel: "💬",
  lead_criado: "✨",
  reativacao_enviada: "🔄",
  prospeccao_enviada: "🎯",
  troca_atendente: "🔁",
};

const COR_POR_TIPO: Record<string, string> = {
  status_mudou: "text-blue-700",
  caio_toggle: "text-purple-700",
  followup_toggle: "text-amber-700",
  followup_enviado: "text-laranja",
  lembrete_enviado: "text-emerald-700",
  msg_painel: "text-preto",
  lead_criado: "text-emerald-700",
  reativacao_enviada: "text-amber-700",
  prospeccao_enviada: "text-blue-700",
  troca_atendente: "text-purple-700",
};

const LIMITE_INICIAL = 5;

export function TimelineEventos({ eventos }: { eventos: Evento[] }) {
  const [expandido, setExpandido] = useState(false);

  if (eventos.length === 0) {
    return (
      <p className="text-xs text-cinza-medio text-center py-6">
        Sem eventos registrados ainda.
      </p>
    );
  }

  const visiveis = expandido ? eventos : eventos.slice(0, LIMITE_INICIAL);

  return (
    <>
    <ul className="space-y-3">
      {visiveis.map((e) => {
        const icone = ICONE_POR_TIPO[e.tipo] ?? "•";
        const cor = COR_POR_TIPO[e.tipo] ?? "text-preto";
        return (
          <li key={e.id} className="flex gap-2.5">
            <span className="flex-shrink-0 w-6 h-6 flex items-center justify-center text-xs">
              {icone}
            </span>
            <div className="flex-1 min-w-0">
              <p className={`text-xs font-heading font-medium ${cor}`}>
                {e.descricao}
              </p>
              <p className="text-[10px] text-cinza-medio mt-0.5">
                {formatarTempo(e.created_at)}
                {e.autor_nome && ` • ${e.autor_nome}`}
              </p>
            </div>
          </li>
        );
      })}
    </ul>
    {eventos.length > LIMITE_INICIAL && (
      <button
        type="button"
        onClick={() => setExpandido((v) => !v)}
        className="mt-3 w-full text-center text-xs text-laranja hover:text-laranja-escuro font-heading font-semibold py-1.5 transition"
      >
        {expandido ? "Ver menos ↑" : `Ver todos (${eventos.length}) ↓`}
      </button>
    )}
    </>
  );
}

function formatarTempo(iso: string): string {
  const d = new Date(iso);
  const diffMs = Date.now() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHrs = Math.floor(diffMs / 3600000);
  const diffDias = Math.floor(diffMs / 86400000);
  if (diffMin < 1) return "agora";
  if (diffMin < 60) return `${diffMin}min atrás`;
  if (diffHrs < 24) return `${diffHrs}h atrás`;
  if (diffDias < 7) return `${diffDias}d atrás`;
  return d.toLocaleDateString("pt-BR");
}
