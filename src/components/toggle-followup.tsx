"use client";

import { useState, useTransition } from "react";
import { toggleFollowupAtivo } from "@/app/dashboard/leads/[id]/actions";

export function ToggleFollowup({
  leadId,
  ativoInicial,
  proximoEm,
  numeroAtual,
}: {
  leadId: string;
  ativoInicial: boolean;
  proximoEm: string | null;
  numeroAtual: number;
}) {
  const [ativo, setAtivo] = useState(ativoInicial);
  const [pending, startTransition] = useTransition();
  const [erro, setErro] = useState<string | null>(null);

  function toggle() {
    setErro(null);
    const novoEstado = !ativo;
    setAtivo(novoEstado); // optimistic
    startTransition(async () => {
      const fd = new FormData();
      fd.set("leadId", leadId);
      fd.set("ativo", novoEstado ? "true" : "false");
      const result = await toggleFollowupAtivo(fd);
      if ("error" in result) {
        setErro(result.error);
        setAtivo(!novoEstado); // reverte
      }
    });
  }

  return (
    <div className="flex items-center gap-3 p-3 rounded-lg bg-offwhite border border-cinza-claro">
      <button
        type="button"
        onClick={toggle}
        disabled={pending}
        className={`relative inline-flex h-6 w-11 items-center rounded-full transition ${
          ativo ? "bg-laranja" : "bg-cinza-claro"
        } disabled:opacity-60`}
        aria-pressed={ativo}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-white transition ${
            ativo ? "translate-x-6" : "translate-x-1"
          }`}
        />
      </button>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-heading font-semibold text-preto">
          Follow-up automático {ativo ? "ligado" : "desligado"}
        </p>
        <p className="text-xs text-cinza-medio mt-0.5">
          {!ativo
            ? "A IA não vai disparar lembretes nesse lead."
            : proximoEm
              ? `Próximo: ${new Date(proximoEm).toLocaleString("pt-BR")} (nível ${numeroAtual + 1})`
              : numeroAtual > 0
                ? `${numeroAtual} follow-up(s) enviados. Sem próximo agendado.`
                : "Aguardando primeira regra."}
        </p>
        {erro && <p className="text-xs text-red-700 mt-1">{erro}</p>}
      </div>
    </div>
  );
}
