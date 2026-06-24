"use client";

import { useState, useTransition } from "react";
import { pausarReativarCliente } from "@/app/admin/clientes/[id]/acoes-actions";

// Single-tenant: a ação de DELETAR cliente foi removida de propósito — deletar a
// org única quebraria o redirect de /admin. Sobra só pausar/reativar.
export function AcoesCliente({
  clienteId,
  ativoInicial,
}: {
  clienteId: string;
  ativoInicial: boolean;
}) {
  const [ativo, setAtivo] = useState(ativoInicial);
  const [pending, startTransition] = useTransition();
  const [erro, setErro] = useState<string | null>(null);

  function togglePausar() {
    setErro(null);
    const novoAtivo = !ativo;
    setAtivo(novoAtivo); // optimistic
    startTransition(async () => {
      const fd = new FormData();
      fd.set("clienteId", clienteId);
      fd.set("ativo", novoAtivo ? "true" : "false");
      const result = await pausarReativarCliente(fd);
      if ("error" in result) {
        setErro(result.error);
        setAtivo(!novoAtivo);
      }
    });
  }

  return (
    <div className="space-y-4">
      {/* Pausar / Reativar */}
      <div className="p-5 bg-white rounded-2xl border border-cinza-claro">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-sm font-heading font-bold text-preto">
              {ativo ? "Pausar cliente" : "Reativar cliente"}
            </h3>
            <p className="text-xs text-cinza-medio mt-1">
              {ativo
                ? "Caio para de responder em todos os leads desse cliente. Não deleta dados."
                : "Caio volta a responder em todos os leads desse cliente."}
            </p>
          </div>
          <button
            type="button"
            onClick={togglePausar}
            disabled={pending}
            className={`px-4 py-2 rounded-lg font-heading font-semibold text-sm transition disabled:opacity-60 ${
              ativo
                ? "bg-amber-100 hover:bg-amber-200 text-amber-800 border border-amber-200"
                : "bg-emerald-100 hover:bg-emerald-200 text-emerald-800 border border-emerald-200"
            }`}
          >
            {pending ? "..." : ativo ? "Pausar" : "Reativar"}
          </button>
        </div>
      </div>

      {erro && (
        <div className="p-3 rounded-lg bg-red-50 border border-red-200">
          <p className="text-sm text-red-800">{erro}</p>
        </div>
      )}
    </div>
  );
}
