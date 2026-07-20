"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  atribuirConversa,
  liberarConversa,
} from "@/app/dashboard/contatos/atribuicao-actions";

/**
 * Controle de atribuição da conversa (reunião Beba Mais 07/2026, item 8).
 * "Pegar" assume a conversa (some da fila de não-atribuídas dos outros e
 * registra quem está com ela). "Liberar" devolve pra fila.
 *
 * `ehMinha` = a conversa está atribuída ao usuário logado. `atribuidoNome` =
 * quem está com ela (null = livre).
 */
export function AtribuirConversa({
  leadId,
  atribuidoNome,
  ehMinha,
}: {
  leadId: string;
  atribuidoNome: string | null;
  ehMinha: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [erro, setErro] = useState<string | null>(null);

  function pegar() {
    setErro(null);
    startTransition(async () => {
      const r = await atribuirConversa(leadId);
      if ("error" in r) setErro(r.error);
      else router.refresh();
    });
  }

  function liberar() {
    setErro(null);
    startTransition(async () => {
      const r = await liberarConversa(leadId);
      if ("error" in r) setErro(r.error);
      else router.refresh();
    });
  }

  // Livre → botão "Pegar conversa"
  if (!atribuidoNome) {
    return (
      <div className="flex flex-col items-end gap-1">
        <button
          type="button"
          onClick={pegar}
          disabled={pending}
          className="px-3 py-1.5 rounded-lg bg-laranja text-white text-sm font-heading font-semibold hover:bg-laranja/90 transition disabled:opacity-50"
        >
          {pending ? "..." : "✋ Pegar conversa"}
        </button>
        {erro && <span className="text-xs text-red-500">{erro}</span>}
      </div>
    );
  }

  // Atribuída → mostra quem está com ela; se é minha, permite liberar.
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        <span
          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-heading font-semibold border ${
            ehMinha
              ? "bg-emerald-50 text-emerald-700 border-emerald-300"
              : "bg-cinza-claro/40 text-cinza-medio border-cinza-claro"
          }`}
        >
          {ehMinha ? "Você" : atribuidoNome}
          <span className="font-normal opacity-70">está atendendo</span>
        </span>
        {ehMinha && (
          <button
            type="button"
            onClick={liberar}
            disabled={pending}
            className="text-xs text-cinza-medio hover:text-preto underline disabled:opacity-50"
          >
            {pending ? "..." : "liberar"}
          </button>
        )}
      </div>
      {erro && <span className="text-xs text-red-500">{erro}</span>}
    </div>
  );
}
