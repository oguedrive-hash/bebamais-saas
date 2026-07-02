"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { moverLeadsParaProspeccao } from "@/app/dashboard/leads/mover-prospeccao-actions";

export function BotaoEnviarProspeccao({
  leadId,
  origemAtual,
}: {
  leadId: string;
  origemAtual: string | null;
}) {
  const router = useRouter();
  const [confirmando, setConfirmando] = useState(false);
  const [pending, startTransition] = useTransition();
  const [erro, setErro] = useState<string | null>(null);

  // Já é prospecção? Não mostra o botão.
  if (origemAtual === "prospeccao") return null;

  function enviar() {
    setErro(null);
    startTransition(async () => {
      const result = await moverLeadsParaProspeccao([leadId]);
      if ("error" in result) {
        setErro(result.error);
        return;
      }
      if (result.relatorio.pulados.length > 0) {
        setErro(result.relatorio.pulados[0].motivo);
        return;
      }
      setConfirmando(false);
      router.refresh();
    });
  }

  if (!confirmando) {
    return (
      <button
        type="button"
        onClick={() => setConfirmando(true)}
        className="text-xs px-3 py-1.5 rounded-lg border border-cinza-claro text-cinza-medio hover:border-laranja hover:text-laranja font-heading font-semibold transition"
        title="Move esse lead pro fluxo de prospecção ativa — a IA começa a cadência de outbound"
      >
        🎯 Enviar pra prospecção
      </button>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={enviar}
          disabled={pending}
          className="text-xs px-3 py-1.5 rounded-lg bg-laranja hover:bg-laranja-escuro disabled:bg-laranja/40 text-white font-heading font-semibold transition"
        >
          {pending ? "Movendo..." : "Confirmar"}
        </button>
        <button
          type="button"
          onClick={() => {
            setConfirmando(false);
            setErro(null);
          }}
          disabled={pending}
          className="text-xs px-3 py-1.5 rounded-lg border border-cinza-claro text-cinza-medio hover:text-preto font-heading font-medium transition"
        >
          Cancelar
        </button>
      </div>
      {erro && (
        <p className="text-[10px] text-red-700 max-w-xs text-right">{erro}</p>
      )}
    </div>
  );
}
