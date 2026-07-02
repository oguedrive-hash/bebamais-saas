"use client";

import { useState, useTransition } from "react";
import { mudarStatusLead } from "@/app/dashboard/leads/[id]/actions";
import {
  STATUS_CONFIG,
  STATUS_ORDEM,
  STATUS_PROSPECCAO_ORDEM,
  type StatusLead,
} from "@/lib/status-config";

const STATUS_TERMINAIS: StatusLead[] = ["fechou", "perdido"];

export function StatusSelector({
  leadId,
  statusAtual,
  incluirProspeccao = false,
}: {
  leadId: string;
  statusAtual: StatusLead;
  // Quando true, lista tambem os status exclusivos de prospeccao
  // (aguardando_primeiro_contato, em_prospeccao). Default falso pra paginas
  // de leads inbound nao mostrarem essas opcoes.
  incluirProspeccao?: boolean;
}) {
  // Se o status atual ja eh um de prospeccao OU foi pedido explicitamente,
  // mostra todos os status (inbound + outbound) — assim o user pode voltar
  // pra inbound se quiser e vice-versa.
  const mostrarTodos =
    incluirProspeccao ||
    (STATUS_PROSPECCAO_ORDEM as StatusLead[]).includes(statusAtual);
  const opcoes: StatusLead[] = mostrarTodos
    ? [...STATUS_PROSPECCAO_ORDEM, ...STATUS_ORDEM]
    : STATUS_ORDEM;
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [erro, setErro] = useState<string | null>(null);
  const [confirmando, setConfirmando] = useState<StatusLead | null>(null);
  const [razao, setRazao] = useState("");

  const config = STATUS_CONFIG[statusAtual];

  function escolherStatus(novo: StatusLead) {
    if (novo === statusAtual) {
      setOpen(false);
      return;
    }
    setOpen(false);
    if (STATUS_TERMINAIS.includes(novo)) {
      // pede razão antes de confirmar
      setConfirmando(novo);
    } else {
      enviar(novo);
    }
  }

  function enviar(novo: StatusLead, razaoTxt?: string) {
    setErro(null);
    const form = new FormData();
    form.set("leadId", leadId);
    form.set("status", novo);
    if (razaoTxt) form.set("razao", razaoTxt);

    startTransition(async () => {
      const result = await mudarStatusLead(form);
      if ("error" in result) {
        setErro(result.error);
        return;
      }
      setConfirmando(null);
      setRazao("");
    });
  }

  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={pending}
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-heading font-semibold border transition disabled:opacity-50 ${config.bg} ${config.cor} ${config.border} hover:opacity-80`}
      >
        <span
          className={`w-1.5 h-1.5 rounded-full ${config.cor.replace("text-", "bg-")}`}
        />
        {pending ? "..." : config.label}
        <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
          <path d="M5 7L1 3h8z" />
        </svg>
      </button>

      {open && (
        <>
          <div
            className="fixed inset-0 z-10"
            onClick={() => setOpen(false)}
          />
          <div className="absolute right-0 mt-2 w-56 bg-white rounded-xl border border-cinza-claro shadow-lg z-20 overflow-hidden">
            <p className="px-3 py-2 text-[10px] font-heading font-semibold text-cinza-medio uppercase tracking-wider border-b border-cinza-claro">
              Mudar status pra
            </p>
            {opcoes.map((s) => {
              const c = STATUS_CONFIG[s];
              const ativo = s === statusAtual;
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => escolherStatus(s)}
                  className={`w-full px-3 py-2 text-left text-sm hover:bg-offwhite transition flex items-center gap-2 ${ativo ? "opacity-50 cursor-default" : ""}`}
                >
                  <span
                    className={`w-2 h-2 rounded-full ${c.cor.replace("text-", "bg-")}`}
                  />
                  <span className="text-preto">{c.label}</span>
                  {ativo && (
                    <span className="ml-auto text-xs text-cinza-medio">
                      atual
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </>
      )}

      {confirmando && (
        <div
          className="fixed inset-0 bg-black/40 z-30 flex items-center justify-center p-4"
          onClick={() => !pending && setConfirmando(null)}
        >
          <div
            className="bg-white rounded-2xl border border-cinza-claro p-6 w-full max-w-md"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-heading font-bold text-preto mb-2">
              Marcar como &ldquo;{STATUS_CONFIG[confirmando].label}&rdquo;?
            </h3>
            <p className="text-sm text-cinza-medio mb-4">
              A IA vai parar de responder esse lead automaticamente e a
              conversa vai ser resolvida no Chatwoot.
            </p>
            <label className="block text-xs font-heading font-semibold text-cinza-medio uppercase tracking-wider mb-2">
              Razão (opcional)
            </label>
            <textarea
              value={razao}
              onChange={(e) => setRazao(e.target.value)}
              rows={2}
              placeholder={
                confirmando === "fechou"
                  ? "ex: cliente fechou pacote mensal"
                  : "ex: não tinha orçamento"
              }
              disabled={pending}
              className="w-full px-3 py-2 border border-cinza-claro rounded-lg text-sm focus:outline-none focus:border-laranja transition"
            />
            <div className="flex items-center justify-end gap-2 mt-4">
              <button
                type="button"
                onClick={() => setConfirmando(null)}
                disabled={pending}
                className="px-4 py-2 text-sm font-heading text-cinza-medio hover:text-preto transition disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => enviar(confirmando, razao)}
                disabled={pending}
                className="px-4 py-2 bg-laranja text-white text-sm font-heading font-semibold rounded-lg hover:bg-laranja/90 transition disabled:opacity-50"
              >
                {pending ? "Salvando..." : "Confirmar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {erro && (
        <p className="text-[10px] text-red-600 mt-1 absolute right-0 top-full whitespace-nowrap">
          {erro}
        </p>
      )}
    </div>
  );
}
