"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deletarAgendamento } from "@/app/dashboard/agenda/actions";

export function BotaoDeletarAgendamento({
  agendamentoId,
  leadNome,
  dataInicio,
}: {
  agendamentoId: string;
  leadNome: string | null;
  dataInicio: string;
}) {
  const router = useRouter();
  const [confirmando, setConfirmando] = useState(false);
  const [pending, startTransition] = useTransition();
  const [erro, setErro] = useState<string | null>(null);

  function deletar() {
    setErro(null);
    const form = new FormData();
    form.set("agendamentoId", agendamentoId);
    startTransition(async () => {
      const result = await deletarAgendamento(form);
      if ("error" in result) {
        setErro(result.error);
        return;
      }
      setConfirmando(false);
      router.refresh();
    });
  }

  const dataFormatada = new Date(dataInicio).toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    weekday: "long",
    day: "2-digit",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <>
      <button
        type="button"
        onClick={() => setConfirmando(true)}
        className="text-xs text-red-600 hover:text-red-700 font-heading font-semibold transition"
        title="Deletar agendamento"
      >
        🗑️
      </button>

      {confirmando && (
        <div
          className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
          onClick={() => !pending && setConfirmando(false)}
        >
          <div
            className="bg-white rounded-2xl border border-cinza-claro p-6 w-full max-w-md"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-heading font-bold text-preto mb-2">
              Deletar agendamento?
            </h3>
            <p className="text-sm text-cinza-medio mb-2">
              <strong>{leadNome ?? "Sem nome"}</strong>
              <br />
              {dataFormatada}
            </p>
            <p className="text-xs text-cinza-medio mb-4">
              Esta ação é <strong>irreversível</strong>. Se houver pedido
              vinculado, ele perde esse horário (a conversa não é afetada).
            </p>

            {erro && (
              <p className="text-xs text-red-600 mb-3">{erro}</p>
            )}

            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmando(false)}
                disabled={pending}
                className="px-4 py-2 text-sm font-heading text-cinza-medio hover:text-preto transition disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={deletar}
                disabled={pending}
                className="px-4 py-2 bg-red-600 text-white text-sm font-heading font-semibold rounded-lg hover:bg-red-700 transition disabled:opacity-50"
              >
                {pending ? "Deletando..." : "Deletar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
