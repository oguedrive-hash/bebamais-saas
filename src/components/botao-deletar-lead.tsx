"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deletarLead } from "@/app/dashboard/leads/[id]/actions";

export function BotaoDeletarLead({
  leadId,
  nomeLead,
}: {
  leadId: string;
  nomeLead: string;
}) {
  const router = useRouter();
  const [confirmando, setConfirmando] = useState(false);
  const [pending, startTransition] = useTransition();
  const [erro, setErro] = useState<string | null>(null);

  function onDeletar() {
    setErro(null);
    const form = new FormData();
    form.set("leadId", leadId);
    startTransition(async () => {
      const result = await deletarLead(form);
      if ("error" in result) {
        setErro(result.error);
        return;
      }
      router.push("/dashboard/contatos");
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setConfirmando(true)}
        className="text-xs text-red-600 hover:text-red-700 font-heading font-semibold transition"
      >
        🗑️ Deletar lead
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
              Deletar &ldquo;{nomeLead}&rdquo;?
            </h3>
            <p className="text-sm text-cinza-medio mb-2">
              Vai apagar <strong>permanentemente</strong> esse lead e todas as
              mensagens e agendamentos vinculados.
            </p>
            <p className="text-xs text-cinza-medio mb-4">
              Se o lead mandar nova mensagem no WhatsApp, ele vai ser recriado
              automaticamente (não some do Chatwoot).
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
                onClick={onDeletar}
                disabled={pending}
                className="px-4 py-2 bg-red-600 text-white text-sm font-heading font-semibold rounded-lg hover:bg-red-700 transition disabled:opacity-50"
              >
                {pending ? "Deletando..." : "Deletar permanentemente"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
