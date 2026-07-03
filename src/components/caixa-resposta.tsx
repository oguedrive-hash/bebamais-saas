"use client";

import { useState, useTransition } from "react";
import {
  responderLead,
  gerarSugestaoResposta,
} from "@/app/dashboard/leads/[id]/actions";

export function CaixaResposta({
  leadId,
  podeResponder,
}: {
  leadId: string;
  podeResponder: boolean;
}) {
  const [pendingEnvio, startEnvioTransition] = useTransition();
  const [pendingSugestao, startSugestaoTransition] = useTransition();
  const [erro, setErro] = useState<string | null>(null);
  const [conteudo, setConteudo] = useState("");
  const [desligarCaio, setDesligarCaio] = useState(true);

  if (!podeResponder) {
    return (
      <div className="border-t border-cinza-claro pt-4 mt-4">
        <p className="text-xs text-cinza-medio text-center">
          Sem conversa vinculada — não dá pra responder este contato ainda.
        </p>
      </div>
    );
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErro(null);
    const form = new FormData(e.currentTarget);
    form.set("leadId", leadId);
    form.set("desligar_caio", desligarCaio ? "true" : "false");

    startEnvioTransition(async () => {
      const result = await responderLead(form);
      if ("error" in result) {
        setErro(result.error);
        return;
      }
      setConteudo("");
    });
  }

  function onSugerir() {
    setErro(null);
    const form = new FormData();
    form.set("leadId", leadId);
    startSugestaoTransition(async () => {
      const result = await gerarSugestaoResposta(form);
      if ("error" in result) {
        setErro(result.error);
        return;
      }
      setConteudo(result.sugestao);
    });
  }

  const pending = pendingEnvio || pendingSugestao;

  return (
    <form onSubmit={onSubmit} className="border-t border-cinza-claro pt-4 mt-4">
      <div className="flex items-center justify-between mb-2">
        <label className="text-xs font-heading font-semibold text-cinza-medio uppercase tracking-wider">
          Responder pelo painel
        </label>
        <button
          type="button"
          onClick={onSugerir}
          disabled={pending}
          className="text-xs text-laranja hover:text-laranja-escuro font-heading font-semibold transition disabled:opacity-50"
          title="Pega o histórico da conversa e gera o que a IA responderia. Edite antes de enviar."
        >
          {pendingSugestao ? "Gerando..." : "Sugerir resposta IA →"}
        </button>
      </div>

      <textarea
        name="conteudo"
        value={conteudo}
        onChange={(e) => setConteudo(e.target.value)}
        rows={3}
        placeholder="Digite uma resposta ou clica em 'Sugerir resposta IA' acima..."
        disabled={pending}
        className="w-full px-3 py-2 border border-cinza-claro rounded-lg text-sm text-preto placeholder:text-cinza-medio focus:outline-none focus:border-laranja transition disabled:opacity-50"
      />

      {erro && <p className="text-xs text-red-600 mt-2">{erro}</p>}

      <div className="flex items-center justify-between gap-3 mt-3">
        <label className="inline-flex items-center gap-2 text-xs text-preto cursor-pointer select-none">
          <input
            type="checkbox"
            checked={desligarCaio}
            onChange={(e) => setDesligarCaio(e.target.checked)}
            disabled={pending}
            className="w-4 h-4 accent-laranja"
          />
          Desligar IA ao enviar
        </label>

        <button
          type="submit"
          disabled={pending || !conteudo.trim()}
          className="px-4 py-2 bg-laranja text-white text-sm font-heading font-semibold rounded-lg hover:bg-laranja/90 transition disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {pendingEnvio ? "Enviando..." : "Enviar"}
        </button>
      </div>
    </form>
  );
}
