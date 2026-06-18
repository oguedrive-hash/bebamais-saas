"use client";

import { useState, useTransition, useEffect } from "react";
import { toggleCaio } from "@/app/dashboard/leads/[id]/actions";

export function ToggleCaio({
  leadId,
  caioAtivoInicial,
}: {
  leadId: string;
  caioAtivoInicial: boolean;
}) {
  const [ativo, setAtivo] = useState(caioAtivoInicial);
  const [pending, startTransition] = useTransition();
  const [erro, setErro] = useState<string | null>(null);

  // Sincroniza com a prop quando o parent re-renderiza (via realtime). Sem
  // isso, o badge fica "preso" no estado inicial — quem desliga Caio pela
  // caixa de resposta (ou outro evento) nao atualiza o badge ate o F5.
  // Skip enquanto pending pra nao atropelar o optimistic update do clique.
  useEffect(() => {
    if (!pending) setAtivo(caioAtivoInicial);
  }, [caioAtivoInicial, pending]);

  function handleToggle() {
    setErro(null);
    const form = new FormData();
    form.set("leadId", leadId);
    const proximoEstado = !ativo;
    setAtivo(proximoEstado); // optimistic
    startTransition(async () => {
      const result = await toggleCaio(form);
      if ("error" in result) {
        setErro(result.error);
        setAtivo(!proximoEstado); // rollback
      }
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleToggle}
        disabled={pending}
        className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-heading font-semibold border transition disabled:opacity-50 ${
          ativo
            ? "bg-green-50 text-green-700 border-green-300 hover:bg-green-100"
            : "bg-red-50 text-red-700 border-red-300 hover:bg-red-100"
        }`}
        title={
          ativo
            ? "Caio responde automaticamente. Clica pra desligar."
            : "Caio está desligado pra esse lead. Clica pra reativar."
        }
      >
        <span
          className={`w-2 h-2 rounded-full ${
            ativo ? "bg-green-500" : "bg-red-500"
          }`}
        />
        {pending
          ? "..."
          : ativo
            ? "Caio respondendo"
            : "Caio desligado"}
      </button>
      {erro && <span className="text-[10px] text-red-600">{erro}</span>}
    </div>
  );
}
