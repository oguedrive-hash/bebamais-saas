"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { BotaoFinalizarHandoff } from "@/components/botao-finalizar-handoff";

export type LeadHandoff = {
  id: string;
  nome: string | null;
  telefone: string;
  precisa_humano_motivo: string | null;
  precisa_humano_em: string | null;
};

export type LeadAguardando = {
  id: string;
  nome: string | null;
  telefone: string;
  precisa_resposta_em: string | null;
};

export function SinoHandoff({
  leads,
  total,
  leadsAguardando = [],
  totalAguardando = 0,
}: {
  leads: LeadHandoff[];
  total: number;
  leadsAguardando?: LeadAguardando[];
  totalAguardando?: number;
}) {
  const totalGeral = total + totalAguardando;
  const [aberto, setAberto] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!aberto) return;
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setAberto(false);
      }
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === "Escape") setAberto(false);
    }
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onEsc);
    };
  }, [aberto]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        title={
          totalGeral > 0
            ? `${totalGeral} notificac${totalGeral > 1 ? "oes" : "ao"} pendente${totalGeral > 1 ? "s" : ""}`
            : "Sem notificacoes"
        }
        className="relative inline-flex items-center justify-center w-9 h-9 rounded-full hover:bg-cinza-claro/60 transition"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`w-5 h-5 ${totalGeral > 0 ? "text-amber-600" : "text-cinza-medio"}`}
        >
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        {totalGeral > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-amber-500 text-white text-[10px] font-heading font-bold flex items-center justify-center border-2 border-white">
            {totalGeral > 99 ? "99+" : totalGeral}
          </span>
        )}
      </button>

      {aberto && (
        <div className="absolute right-0 mt-2 w-96 bg-white rounded-2xl border border-cinza-claro shadow-xl z-50 overflow-hidden">
          <div className="px-4 py-3 border-b border-cinza-claro flex items-center justify-between">
            <h3 className="text-sm font-heading font-bold text-preto">
              Notificacoes
            </h3>
            <span className="text-xs text-cinza-medio">
              {totalGeral} pendente{totalGeral !== 1 ? "s" : ""}
            </span>
          </div>

          {totalGeral === 0 ? (
            <div className="px-4 py-8 text-center">
              <p className="text-sm text-cinza-medio">
                Tudo em dia — nenhuma notificacao.
              </p>
            </div>
          ) : (
            <div className="max-h-[480px] overflow-y-auto">
              {totalAguardando > 0 && (
                <div>
                  <div className="px-4 py-2 bg-amber-50/60 border-b border-amber-200">
                    <p className="text-[11px] font-heading font-bold text-amber-800 uppercase tracking-wider">
                      Aguardando sua resposta ({totalAguardando})
                    </p>
                  </div>
                  {leadsAguardando.map((lead) => (
                    <Link
                      key={`aguard-${lead.id}`}
                      href={`/dashboard/contatos/${lead.id}`}
                      onClick={() => setAberto(false)}
                      className="block px-4 py-3 border-b border-cinza-claro/60 hover:bg-offwhite transition"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <p className="font-heading font-semibold text-preto text-sm truncate">
                            {lead.nome ?? "Sem nome"}
                          </p>
                          <p className="text-xs text-cinza-medio font-mono mt-0.5">
                            {lead.telefone}
                          </p>
                          <p className="text-[11px] text-amber-700 font-heading font-semibold mt-1">
                            Mensagem nova (IA desligada)
                          </p>
                        </div>
                        <span className="text-[10px] text-cinza-medio whitespace-nowrap mt-0.5">
                          {tempoRelativo(lead.precisa_resposta_em)}
                        </span>
                      </div>
                    </Link>
                  ))}
                </div>
              )}

              {total > 0 && (
                <div>
                  <div className="px-4 py-2 bg-cinza-claro/40 border-b border-cinza-claro">
                    <p className="text-[11px] font-heading font-bold text-cinza-medio uppercase tracking-wider">
                      Handoff p/ humano ({total})
                    </p>
                  </div>
                  {leads.map((lead) => (
                    <div
                      key={`handoff-${lead.id}`}
                      className="flex items-start gap-2 px-4 py-3 border-b border-cinza-claro/60 last:border-b-0 hover:bg-offwhite transition"
                    >
                      <Link
                        href={`/dashboard/contatos/${lead.id}`}
                        onClick={() => setAberto(false)}
                        className="flex-1 min-w-0 block"
                      >
                        <p className="font-heading font-semibold text-preto text-sm truncate">
                          {lead.nome ?? "Sem nome"}
                        </p>
                        <p className="text-xs text-cinza-medio font-mono mt-0.5">
                          {lead.telefone}
                        </p>
                        <p className="text-[11px] text-amber-700 font-heading font-semibold mt-1">
                          {labelMotivo(lead.precisa_humano_motivo)}
                        </p>
                      </Link>
                      <div className="flex flex-col items-end gap-1.5 shrink-0">
                        <span className="text-[10px] text-cinza-medio whitespace-nowrap">
                          {tempoRelativo(lead.precisa_humano_em)}
                        </span>
                        <BotaoFinalizarHandoff leadId={lead.id} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {(total > leads.length || totalAguardando > leadsAguardando.length) && (
            <Link
              href="/dashboard/contatos"
              onClick={() => setAberto(false)}
              className="block px-4 py-3 text-center text-xs text-laranja hover:text-laranja-escuro font-heading font-semibold border-t border-cinza-claro"
            >
              Ver todos →
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

function labelMotivo(motivo: string | null): string {
  if (motivo === "muda_reuniao") return "⚠ Quer mudar retirada";
  if (motivo === "irritado") return "⚠ Lead irritado";
  if (motivo === "pede_humano") return "⚠ Pediu humano";
  return "⚠ Precisa humano";
}

function tempoRelativo(em: string | null): string {
  if (!em) return "";
  const diffMs = Date.now() - new Date(em).getTime();
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `${min}min`;
  const hrs = Math.floor(diffMs / 3600000);
  if (hrs < 24) return `${hrs}h`;
  const dias = Math.floor(diffMs / 86400000);
  return `${dias}d`;
}
