"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { mudarStatusAgendamento } from "@/app/dashboard/agenda/actions";

type Status = "sugerido" | "agendado" | "realizado" | "no_show" | "cancelado";

const STATUS_CONFIG: Record<
  Status,
  { label: string; cor: string }
> = {
  sugerido: {
    label: "Sugerido pelo cliente",
    cor: "bg-amber-50 text-amber-700 border-amber-300",
  },
  agendado: {
    label: "Confirmado",
    cor: "bg-emerald-50 text-emerald-700 border-emerald-200",
  },
  realizado: {
    label: "Realizado",
    cor: "bg-blue-50 text-blue-700 border-blue-200",
  },
  no_show: {
    label: "No-show",
    cor: "bg-red-50 text-red-700 border-red-200",
  },
  cancelado: {
    label: "Cancelado",
    cor: "bg-cinza-claro text-cinza-medio border-cinza-claro",
  },
};

export function StatusAgendamentoSelector({
  agendamentoId,
  statusAtual,
}: {
  agendamentoId: string;
  statusAtual: string;
}) {
  const [aberto, setAberto] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>(
    (statusAtual as Status) ?? "agendado",
  );
  const [pending, startTransition] = useTransition();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setAberto(false);
      }
    }
    if (aberto) document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [aberto]);

  function escolher(novo: Status) {
    if (novo === status) {
      setAberto(false);
      return;
    }
    // Cancelar tem efeito colateral destrutivo (desvincula o pedido) — pede
    // confirmação; os outros status são reversíveis pelo próprio dropdown.
    if (
      novo === "cancelado" &&
      !window.confirm(
        "Cancelar esse horário? Ele sai do pedido vinculado (se houver).",
      )
    ) {
      setAberto(false);
      return;
    }
    const anterior = status; // último status confirmado (não a prop inicial)
    setStatus(novo);
    setAberto(false);
    setErro(null);
    startTransition(async () => {
      try {
        const fd = new FormData();
        fd.set("agendamentoId", agendamentoId);
        fd.set("status", novo);
        const result = await mudarStatusAgendamento(fd);
        if ("error" in result) {
          setErro(result.error);
          setStatus(anterior); // reverte pro último status que deu certo
        }
      } catch {
        setErro("Falha de conexão — tente de novo.");
        setStatus(anterior);
      }
    });
  }

  const config = STATUS_CONFIG[status] ?? STATUS_CONFIG.agendado;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        disabled={pending}
        className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-heading font-semibold border ${config.cor} hover:opacity-80 transition disabled:opacity-50`}
      >
        {config.label}
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="w-3 h-3"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {aberto && (
        <div className="absolute right-0 top-full mt-1 z-20 w-44 bg-white border border-cinza-claro rounded-lg shadow-lg py-1">
          {(Object.keys(STATUS_CONFIG) as Status[]).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => escolher(s)}
              className={`w-full px-3 py-2 text-sm text-left hover:bg-offwhite transition flex items-center gap-2 ${
                s === status ? "font-semibold" : ""
              }`}
            >
              <span
                className={`inline-block px-1.5 py-0.5 rounded-full text-[10px] font-heading font-semibold border ${STATUS_CONFIG[s].cor}`}
              >
                {STATUS_CONFIG[s].label}
              </span>
              {s === status && (
                <span className="text-laranja text-xs ml-auto">✓</span>
              )}
            </button>
          ))}
        </div>
      )}
      {erro && (
        <p className="absolute right-0 top-full mt-1 z-20 w-56 text-[11px] text-red-700 bg-red-50 border border-red-200 rounded-lg px-2 py-1.5 shadow-sm">
          {erro}
        </p>
      )}
    </div>
  );
}
