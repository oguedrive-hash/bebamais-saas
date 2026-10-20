"use client";

import Link from "next/link";
import { useState } from "react";
import type { GrupoResumo, MensagemPainel } from "@/lib/atendimento/painel";
import { enviarArquivoGrupoAction, enviarMensagemGrupoAction } from "./actions";
import { Escrever, ListaMensagens } from "./conversa";

/** Grupo do WhatsApp aberto: qualquer pessoa da equipe lê e responde. O assistente não participa. */
export function GrupoConversa({
  grupo,
  mensagens,
  voltarHref,
}: {
  grupo: GrupoResumo;
  mensagens: MensagemPainel[];
  voltarHref: string;
}) {
  const [erro, setErro] = useState<string | null>(null);

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="bg-white border-b border-cinza-claro px-4 py-3 flex items-center gap-3">
        <Link href={voltarHref} className="md:hidden text-vermelho font-semibold text-sm">← Voltar</Link>
        <span className="shrink-0 h-10 w-10 rounded-full bg-amber-100 text-amber-800 flex items-center justify-center text-lg" aria-hidden>
          👥
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-heading font-semibold text-lg text-preto truncate">{grupo.nome}</p>
          <p className="text-sm text-cinza-medio">
            Grupo do WhatsApp{grupo.numeroApelido ? <> · pelo número <strong>{grupo.numeroApelido}</strong></> : null}
          </p>
        </div>
      </div>

      <div className="border-b px-4 py-3 bg-amber-50 border-amber-200 text-amber-900 text-sm">
        Grupo interno da loja. <strong>O assistente não participa de grupos.</strong> Qualquer pessoa da equipe pode ler e
        responder aqui, sem precisar pegar.
      </div>

      {erro && (
        <div className="bg-red-50 border-b border-red-200 text-red-800 text-sm px-4 py-2 flex justify-between gap-3">
          <span>{erro}</span>
          <button onClick={() => setErro(null)} className="font-semibold">Fechar</button>
        </div>
      )}

      <ListaMensagens mensagens={mensagens} />

      <Escrever
        respostasRapidas={[]}
        onErro={setErro}
        placeholder="Escreva para o grupo... (Enter envia)"
        onEnviar={(texto, arquivo) => {
          if (!arquivo) return enviarMensagemGrupoAction(grupo.id, texto);
          const fd = new FormData();
          fd.set("grupoId", grupo.id);
          fd.set("arquivo", arquivo);
          fd.set("legenda", texto);
          return enviarArquivoGrupoAction(fd);
        }}
      />
    </div>
  );
}
