"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { moverLeadsParaInbound } from "@/app/dashboard/leads/voltar-inbound-actions";

export function BotaoVoltarInbound({
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

  // Já é inbound? Não mostra.
  if (origemAtual !== "prospeccao") return null;

  function voltar() {
    setErro(null);
    startTransition(async () => {
      const result = await moverLeadsParaInbound([leadId]);
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
        className="text-xs px-3 py-1.5 rounded-lg border border-cinza-claro text-cinza-medio hover:border-preto hover:text-preto font-heading font-semibold transition"
        title="Tira da prospecção e marca como inbound (em conversa, IA ligada)"
      >
        ← Voltar pra Inbound
      </button>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={voltar}
          disabled={pending}
          className="text-xs px-3 py-1.5 rounded-lg bg-preto hover:bg-preto/80 disabled:bg-preto/40 text-white font-heading font-semibold transition"
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
