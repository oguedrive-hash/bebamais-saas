"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { remarcarAgendamento } from "@/app/dashboard/agenda/actions";

function localDatetimeMin(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Remarcar em 1 passo — troca dia/horário mantendo lead, status e vínculo
 * com o pedido (antes: cancelar + criar novo + buscar o lead = 6-7 passos).
 */
export function BotaoRemarcarAgendamento({
  agendamentoId,
  leadNome,
}: {
  agendamentoId: string;
  leadNome: string | null;
}) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [dataHora, setDataHora] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function salvar() {
    if (pending) return;
    setErro(null);
    const form = new FormData();
    form.set("agendamentoId", agendamentoId);
    form.set("dataHora", dataHora);
    startTransition(async () => {
      try {
        const r = await remarcarAgendamento(form);
        if ("error" in r) {
          setErro(r.error);
          return;
        }
        setAberto(false);
        setDataHora("");
        router.refresh();
      } catch {
        setErro("Falha de conexão — tente de novo.");
      }
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setAberto(true)}
        className="text-xs text-cinza-medio hover:text-preto font-heading font-semibold transition"
        title="Mudar dia/horário mantendo o vínculo com o pedido"
      >
        📆 Remarcar
      </button>

      {aberto && (
        <div
          className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
          onClick={() => !pending && setAberto(false)}
        >
          <div
            className="bg-white rounded-2xl border border-cinza-claro p-6 w-full max-w-md"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-heading font-bold text-preto mb-1">
              Remarcar retirada
            </h3>
            <p className="text-sm text-cinza-medio mb-4">
              {leadNome ?? "Contato"} — escolha o novo dia e horário. Os
              lembretes são reagendados; o pedido continua vinculado.
            </p>
            <input
              type="datetime-local"
              value={dataHora}
              min={localDatetimeMin()}
              onChange={(e) => setDataHora(e.target.value)}
              className="w-full px-3 py-2.5 rounded-lg border border-cinza-claro text-sm focus:outline-none focus:border-laranja transition mb-3"
            />
            {erro && <p className="text-xs text-red-600 mb-3">{erro}</p>}
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setAberto(false)}
                disabled={pending}
                className="px-4 py-2 text-sm font-heading text-cinza-medio hover:text-preto transition disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={salvar}
                disabled={pending || !dataHora}
                className="px-4 py-2 bg-laranja text-white text-sm font-heading font-semibold rounded-lg hover:bg-laranja-escuro transition disabled:opacity-50"
              >
                {pending ? "Remarcando..." : "Remarcar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
