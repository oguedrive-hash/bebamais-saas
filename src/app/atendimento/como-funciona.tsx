"use client";

import { useState } from "react";
import { COR_SITUACAO, type Situacao } from "./util";

const PASSOS = [
  "O assistente responde o cliente primeiro e, quando precisa de uma pessoa, coloca a conversa em “Esperando atendente”.",
  "Clique num cliente em vermelho e depois em “Pegar este cliente”. Agora ele é seu: responda pela caixa de mensagem, como no WhatsApp.",
  "Precisa que outra pessoa continue? Use “Passar para outra atendente”.",
  "Resolveu? Clique em “Finalizar atendimento”. Se o cliente escrever de novo, o assistente atende primeiro.",
  "Quer falar com alguém de uma conversa antiga? Abra “Todas as conversas”, clique no cliente e em “Retomar conversa”.",
];

const SIGNIFICADO: Record<Situacao, string> = {
  esperando: "esperando uma atendente: pegue logo",
  minha: "você está atendendo",
  assistente: "o assistente está conversando",
  outra: "outra atendente (ou alguém pelo celular) está atendendo",
  finalizada: "atendimento encerrado",
};

/** Botão "Como funciona?" do topo do atendimento: ajuda rápida para quem está começando. */
export function ComoFunciona() {
  const [aberto, setAberto] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setAberto(true)}
        className="rounded-full border border-cinza-claro px-3 py-1 text-sm font-heading font-semibold text-preto hover:border-preto"
      >
        ? Como funciona
      </button>
      {aberto && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={() => setAberto(false)}>
          <div className="bg-white rounded-2xl p-6 max-w-lg w-full max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <p className="font-heading font-bold text-xl text-preto mb-3">Como funciona o atendimento</p>
            <ol className="list-decimal pl-5 space-y-2 text-sm text-preto">
              {PASSOS.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ol>
            <p className="font-heading font-semibold text-preto mt-5 mb-2">O que cada cor quer dizer</p>
            <ul className="space-y-1.5 text-sm">
              {(Object.keys(COR_SITUACAO) as Situacao[]).map((s) => (
                <li key={s} className="flex items-center gap-2">
                  <span className={`text-[11px] font-semibold rounded px-1.5 py-0.5 ${COR_SITUACAO[s].chip}`}>{COR_SITUACAO[s].rotulo}</span>
                  <span className="text-cinza-medio">{SIGNIFICADO[s]}</span>
                </li>
              ))}
            </ul>
            <p className="mt-5 text-xs text-cinza-medio">
              Se alguém da loja responder pelo celular, o assistente sai daquela conversa sozinho.
            </p>
            <div className="text-right mt-4">
              <button type="button" onClick={() => setAberto(false)} className="rounded-lg bg-vermelho text-white px-5 py-2 font-heading font-bold">
                Entendi
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
