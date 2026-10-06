"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ClienteResumo, MensagemPainel } from "@/lib/atendimento/painel";
import {
  enviarArquivoAction,
  enviarMensagemAction,
  finalizarAtendimento,
  passarCliente,
  pegarCliente,
} from "./actions";
import { ROTULO_ASSUNTO, dataCurta, horaCurta, tempoDesde, useAgora } from "./util";

interface Props {
  usuario: { id: string; nome: string; admin: boolean };
  cliente: ClienteResumo;
  mensagens: MensagemPainel[];
  atendentes: { id: string; nome: string }[];
  respostasRapidas: string[];
  voltarHref: string;
}

export function Conversa({ usuario, cliente, mensagens, atendentes, respostasRapidas, voltarHref }: Props) {
  const router = useRouter();
  const agora = useAgora(20000);
  const [pendente, iniciar] = useTransition();
  const [erro, setErro] = useState<string | null>(null);
  const [dialogo, setDialogo] = useState<null | "passar" | "finalizar" | "assumir">(null);

  const meu = cliente.status === "atendendo" && cliente.atribuidoA === usuario.id;
  const comOutra = cliente.status === "atendendo" && !!cliente.atribuidoA && cliente.atribuidoA !== usuario.id;

  function executar(acao: () => Promise<{ ok: true } | { error: string }>, depois?: () => void) {
    setErro(null);
    iniciar(async () => {
      const r = await acao();
      if ("error" in r) setErro(r.error);
      else {
        depois?.();
        router.refresh();
      }
    });
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {/* Cabeçalho do cliente */}
      <div className="bg-white border-b border-cinza-claro px-4 py-3 flex items-center gap-3">
        <Link href={voltarHref} className="md:hidden text-vermelho font-semibold text-sm">← Voltar</Link>
        <div className="min-w-0 flex-1">
          <p className="font-heading font-semibold text-lg text-preto truncate">{cliente.nome}</p>
          <p className="text-sm text-cinza-medio flex flex-wrap gap-x-3">
            <span>{cliente.telefone}</span>
            {cliente.numeroApelido && <span>escreveu para: <strong>{cliente.numeroApelido}</strong></span>}
            {cliente.assunto && <span>assunto: <strong>{ROTULO_ASSUNTO[cliente.assunto]}</strong></span>}
          </p>
        </div>
      </div>

      {/* O que fazer agora */}
      <FaixaDeStatus
        cliente={cliente}
        meu={meu}
        comOutra={comOutra}
        agora={agora}
        pendente={pendente}
        onPegar={() => executar(() => pegarCliente(cliente.id))}
        onAssumir={() => setDialogo("assumir")}
        onPassar={() => setDialogo("passar")}
        onFinalizar={() => setDialogo("finalizar")}
      />

      {erro && (
        <div className="bg-red-50 border-b border-red-200 text-red-800 text-sm px-4 py-2 flex justify-between gap-3">
          <span>{erro}</span>
          <button onClick={() => setErro(null)} className="font-semibold">Fechar</button>
        </div>
      )}

      <ListaMensagens mensagens={mensagens} />

      {meu ? (
        <Escrever clienteId={cliente.id} respostasRapidas={respostasRapidas} onErro={setErro} />
      ) : (
        <div className="bg-white border-t border-cinza-claro p-4 text-center text-sm text-cinza-medio">
          {cliente.status === "atendendo" && comOutra
            ? `Este cliente está sendo atendido por ${cliente.atribuidoNome ?? "outra atendente"}.`
            : "Para responder, primeiro clique em “Pegar este cliente”."}
        </div>
      )}

      {dialogo === "finalizar" && (
        <Dialogo
          titulo="Finalizar atendimento?"
          texto="Use quando o pedido ou a dúvida do cliente estiver resolvido. Se ele mandar mensagem de novo, o assistente atende primeiro."
          confirmar="Sim, finalizar"
          onCancelar={() => setDialogo(null)}
          onConfirmar={() => executar(() => finalizarAtendimento(cliente.id), () => { setDialogo(null); router.push(voltarHref); })}
          pendente={pendente}
        />
      )}
      {dialogo === "assumir" && (
        <Dialogo
          titulo={`Assumir este cliente?`}
          texto={`Ele está com ${cliente.atribuidoNome ?? "outra atendente"}. Só assuma se ela não puder continuar.`}
          confirmar="Sim, assumir"
          onCancelar={() => setDialogo(null)}
          onConfirmar={() => executar(() => pegarCliente(cliente.id, true), () => setDialogo(null))}
          pendente={pendente}
        />
      )}
      {dialogo === "passar" && (
        <DialogoPassar
          atendentes={atendentes}
          pendente={pendente}
          onCancelar={() => setDialogo(null)}
          onEscolher={(id) => executar(() => passarCliente(cliente.id, id), () => { setDialogo(null); router.push(voltarHref); })}
        />
      )}
    </div>
  );
}

function FaixaDeStatus(props: {
  cliente: ClienteResumo;
  meu: boolean;
  comOutra: boolean;
  agora: number;
  pendente: boolean;
  onPegar: () => void;
  onAssumir: () => void;
  onPassar: () => void;
  onFinalizar: () => void;
}) {
  const { cliente } = props;
  const botaoPrincipal = "rounded-lg px-5 py-2.5 font-heading font-bold text-base disabled:opacity-50";
  const botaoSecundario = "rounded-lg px-4 py-2 font-heading font-semibold text-sm border disabled:opacity-50";

  if (props.meu) {
    return (
      <div className="bg-green-50 border-b border-green-200 px-4 py-3 flex flex-wrap items-center justify-between gap-3">
        <p className="text-green-900 font-semibold">✓ Você está atendendo este cliente.</p>
        <div className="flex gap-2">
          <button onClick={props.onPassar} disabled={props.pendente} className={`${botaoSecundario} border-cinza-claro bg-white text-preto`}>
            Passar para outra atendente
          </button>
          <button onClick={props.onFinalizar} disabled={props.pendente} className={`${botaoSecundario} border-green-700 bg-green-700 text-white`}>
            Finalizar atendimento
          </button>
        </div>
      </div>
    );
  }

  let texto: React.ReactNode;
  let cor = "bg-offwhite border-cinza-claro text-preto";
  let botao: React.ReactNode = (
    <button onClick={props.onPegar} disabled={props.pendente} className={`${botaoPrincipal} bg-vermelho text-white`}>
      {props.pendente ? "Pegando..." : "Pegar este cliente"}
    </button>
  );
  if (cliente.status === "aguardando") {
    cor = "bg-red-50 border-red-200 text-red-900";
    texto = (
      <>
        <strong>Esperando atendente</strong>
        {cliente.aguardandoDesde ? ` há ${tempoDesde(cliente.aguardandoDesde, props.agora)}` : ""}.
      </>
    );
  } else if (cliente.status === "bot") {
    texto = "O assistente está conversando com este cliente. Se quiser, pegue a conversa agora.";
  } else if (props.comOutra) {
    texto = <>Com <strong>{cliente.atribuidoNome}</strong>.</>;
    botao = (
      <button onClick={props.onAssumir} disabled={props.pendente} className={`${botaoSecundario} border-cinza-claro bg-white text-preto`}>
        Assumir este cliente
      </button>
    );
  } else if (cliente.status === "atendendo") {
    texto = "Alguém da loja respondeu este cliente pelo celular.";
  } else {
    texto = "Atendimento finalizado.";
    botao = (
      <button onClick={props.onPegar} disabled={props.pendente} className={`${botaoSecundario} border-cinza-claro bg-white text-preto`}>
        Atender de novo
      </button>
    );
  }
  return (
    <div className={`border-b px-4 py-3 flex flex-wrap items-center justify-between gap-3 ${cor}`}>
      <p>{texto}</p>
      {botao}
    </div>
  );
}

function ListaMensagens({ mensagens }: { mensagens: MensagemPainel[] }) {
  const fimRef = useRef<HTMLDivElement>(null);
  const ultimaId = mensagens[mensagens.length - 1]?.id;
  useEffect(() => {
    fimRef.current?.scrollIntoView({ block: "end" });
  }, [ultimaId]);

  return (
    <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-2 bg-[#efeae2]">
      {mensagens.length === 0 && <p className="text-center text-sm text-cinza-medio">Nenhuma mensagem ainda.</p>}
      {mensagens.map((m, i) => {
        const dia = dataCurta(m.em);
        const separador = i === 0 || dia !== dataCurta(mensagens[i - 1].em);
        return (
          <div key={m.id}>
            {separador && (
              <div className="text-center my-3">
                <span className="text-xs bg-white/80 text-cinza-medio rounded-full px-3 py-1">{dia}</span>
              </div>
            )}
            <Balao m={m} />
          </div>
        );
      })}
      <div ref={fimRef} />
    </div>
  );
}

function Balao({ m }: { m: MensagemPainel }) {
  const cor = m.doCliente ? "bg-white" : m.autor === "assistente" ? "bg-blue-50 border border-blue-100" : "bg-[#d9fdd3]";
  return (
    <div className={`flex ${m.doCliente ? "justify-start" : "justify-end"}`}>
      <div className={`max-w-[85%] md:max-w-[70%] rounded-xl px-3 py-2 shadow-sm ${cor}`}>
        <p className={`text-[11px] font-semibold mb-0.5 ${m.autor === "assistente" ? "text-blue-700" : "text-cinza-medio"}`}>{m.remetente}</p>
        <Conteudo m={m} />
        <p className="text-[11px] text-cinza-medio text-right mt-1">
          {m.falhou ? <span className="text-red-700 font-semibold">Não foi enviada · </span> : null}
          {horaCurta(m.em)}
        </p>
      </div>
    </div>
  );
}

function Conteudo({ m }: { m: MensagemPainel }) {
  const texto = m.texto ? <p className="whitespace-pre-wrap break-words text-[15px] text-preto">{m.texto}</p> : null;
  if (m.tipo === "imagem") {
    return (
      <div className="space-y-1">
        {m.arquivoUrl ? (
          <a href={m.arquivoUrl} target="_blank" rel="noreferrer">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={m.arquivoUrl} alt="Foto" className="rounded-lg max-h-72 object-contain bg-black/5" />
          </a>
        ) : (
          <p className="text-sm text-cinza-medio">📷 Foto (não foi possível carregar)</p>
        )}
        {texto}
      </div>
    );
  }
  if (m.tipo === "audio") {
    return (
      <div className="space-y-1">
        {m.arquivoUrl && <audio controls src={m.arquivoUrl} className="max-w-full" />}
        {m.texto ? <p className="text-sm italic text-preto">“{m.texto}”</p> : <p className="text-sm text-cinza-medio">🎤 Áudio</p>}
      </div>
    );
  }
  if (m.tipo === "video") {
    return (
      <div className="space-y-1">
        {m.arquivoUrl ? <video controls src={m.arquivoUrl} className="rounded-lg max-h-72" /> : <p className="text-sm">🎬 Vídeo</p>}
        {texto}
      </div>
    );
  }
  if (m.tipo === "arquivo") {
    return (
      <div className="space-y-1">
        {m.arquivoUrl ? (
          <a href={m.arquivoUrl} target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded-lg bg-black/5 px-3 py-2 text-sm font-semibold text-preto hover:bg-black/10">
            📎 {m.arquivoNome ?? "Abrir arquivo"}
          </a>
        ) : (
          <p className="text-sm">📎 {m.arquivoNome ?? "Arquivo"}</p>
        )}
        {texto}
      </div>
    );
  }
  if (m.tipo === "localizacao") {
    const link = m.texto?.match(/https?:\/\/\S+/)?.[0];
    const nome = m.texto?.replace(/https?:\/\/\S+/, "").trim();
    return (
      <div className="space-y-1">
        <p className="text-sm">📍 {nome || "Localização"}</p>
        {link && (
          <a href={link} target="_blank" rel="noreferrer" className="text-sm font-semibold text-blue-700 underline">
            Ver no mapa
          </a>
        )}
      </div>
    );
  }
  return texto ?? <p className="text-sm text-cinza-medio">(mensagem sem texto)</p>;
}

function Escrever({
  clienteId,
  respostasRapidas,
  onErro,
}: {
  clienteId: string;
  respostasRapidas: string[];
  onErro: (e: string | null) => void;
}) {
  const router = useRouter();
  const [texto, setTexto] = useState("");
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [previa, setPrevia] = useState<string | null>(null);
  const [enviando, iniciar] = useTransition();
  const inputArquivo = useRef<HTMLInputElement>(null);
  const caixa = useRef<HTMLTextAreaElement>(null);

  // Libera a prévia da memória quando troca ou tira o arquivo.
  useEffect(() => {
    return () => {
      if (previa) URL.revokeObjectURL(previa);
    };
  }, [previa]);

  function escolher(f: File | null | undefined) {
    if (!f) return;
    if (f.size > 15 * 1024 * 1024) {
      onErro("Arquivo grande demais (máximo 15 MB).");
      return;
    }
    setArquivo(f);
    setPrevia(f.type.startsWith("image/") ? URL.createObjectURL(f) : null);
  }

  function tirarArquivo() {
    setArquivo(null);
    setPrevia(null);
  }

  function enviar() {
    if (enviando) return;
    if (!arquivo && !texto.trim()) return;
    onErro(null);
    iniciar(async () => {
      let r: { ok: true } | { error: string };
      if (arquivo) {
        const fd = new FormData();
        fd.set("leadId", clienteId);
        fd.set("arquivo", arquivo);
        fd.set("legenda", texto);
        r = await enviarArquivoAction(fd);
      } else {
        r = await enviarMensagemAction(clienteId, texto);
      }
      if ("error" in r) {
        onErro(r.error);
        return;
      }
      setTexto("");
      tirarArquivo();
      router.refresh();
      caixa.current?.focus();
    });
  }

  return (
    <div className="bg-white border-t border-cinza-claro p-3 space-y-2">
      {respostasRapidas.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          <span className="shrink-0 text-xs text-cinza-medio self-center">Respostas prontas:</span>
          {respostasRapidas.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => {
                setTexto(r);
                caixa.current?.focus();
              }}
              className="shrink-0 rounded-full border border-cinza-claro bg-offwhite hover:bg-dourado/20 px-3 py-1 text-sm text-preto"
            >
              {r}
            </button>
          ))}
        </div>
      )}

      {arquivo && (
        <div className="flex items-center gap-3 rounded-lg border border-cinza-claro bg-offwhite p-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {previa ? <img src={previa} alt="" className="h-16 w-16 object-cover rounded" /> : <span className="text-2xl">📎</span>}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold truncate">{arquivo.name}</p>
            <p className="text-xs text-cinza-medio">Escreva uma legenda abaixo se quiser, e clique em Enviar.</p>
          </div>
          <button onClick={tirarArquivo} className="text-sm font-semibold text-vermelho">Tirar</button>
        </div>
      )}

      <div className="flex items-end gap-2">
        <button
          type="button"
          onClick={() => inputArquivo.current?.click()}
          className="shrink-0 rounded-lg border border-cinza-claro bg-white px-3 py-2.5 text-sm font-semibold text-preto hover:bg-offwhite"
          title="Enviar foto ou arquivo"
        >
          📷 Foto ou arquivo
        </button>
        <input
          ref={inputArquivo}
          type="file"
          className="hidden"
          accept="image/*,application/pdf,.xls,.xlsx,.csv,.doc,.docx"
          onChange={(e) => {
            escolher(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        <textarea
          ref={caixa}
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              enviar();
            }
          }}
          onPaste={(e) => {
            const img = [...e.clipboardData.items].find((i) => i.type.startsWith("image/"))?.getAsFile();
            if (img) {
              e.preventDefault();
              escolher(new File([img], `print-${Date.now()}.png`, { type: img.type }));
            }
          }}
          rows={2}
          placeholder={arquivo ? "Legenda (opcional)" : "Escreva a mensagem... (Enter envia)"}
          className="flex-1 resize-none rounded-lg border border-cinza-claro px-3 py-2 text-[15px] focus:outline-none focus:border-vermelho"
        />
        <button
          type="button"
          onClick={enviar}
          disabled={enviando || (!arquivo && !texto.trim())}
          className="shrink-0 rounded-lg bg-vermelho text-white px-5 py-2.5 font-heading font-bold disabled:opacity-40"
        >
          {enviando ? "Enviando..." : "Enviar"}
        </button>
      </div>
      <p className="text-[11px] text-cinza-medio">Dica: para mandar o print do pedido, copie a imagem e cole aqui com Ctrl+V.</p>
    </div>
  );
}

function Dialogo(props: {
  titulo: string;
  texto: string;
  confirmar: string;
  pendente: boolean;
  onCancelar: () => void;
  onConfirmar: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={props.onCancelar}>
      <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <p className="text-lg font-heading font-bold text-preto mb-2">{props.titulo}</p>
        <p className="text-cinza-medio mb-6">{props.texto}</p>
        <div className="flex justify-end gap-3">
          <button onClick={props.onCancelar} className="rounded-lg border border-cinza-claro px-4 py-2 font-semibold">Cancelar</button>
          <button onClick={props.onConfirmar} disabled={props.pendente} className="rounded-lg bg-vermelho text-white px-4 py-2 font-heading font-bold disabled:opacity-50">
            {props.pendente ? "Aguarde..." : props.confirmar}
          </button>
        </div>
      </div>
    </div>
  );
}

function DialogoPassar(props: {
  atendentes: { id: string; nome: string }[];
  pendente: boolean;
  onCancelar: () => void;
  onEscolher: (id: string | null) => void;
}) {
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={props.onCancelar}>
      <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <p className="text-lg font-heading font-bold text-preto mb-1">Passar este cliente para quem?</p>
        <p className="text-sm text-cinza-medio mb-4">A atendente escolhida vê o cliente em “Minhas conversas”.</p>
        <div className="space-y-2 max-h-72 overflow-y-auto">
          {props.atendentes.map((a) => (
            <button
              key={a.id}
              disabled={props.pendente}
              onClick={() => props.onEscolher(a.id)}
              className="w-full text-left rounded-lg border border-cinza-claro px-4 py-3 font-semibold hover:bg-offwhite disabled:opacity-50"
            >
              {a.nome}
            </button>
          ))}
          <button
            disabled={props.pendente}
            onClick={() => props.onEscolher(null)}
            className="w-full text-left rounded-lg border border-dashed border-cinza-medio px-4 py-3 hover:bg-offwhite disabled:opacity-50"
          >
            <span className="font-semibold">Qualquer uma</span>
            <span className="block text-sm text-cinza-medio">O cliente volta para “Esperando atendente”.</span>
          </button>
        </div>
        <div className="flex justify-end mt-4">
          <button onClick={props.onCancelar} className="rounded-lg border border-cinza-claro px-4 py-2 font-semibold">Cancelar</button>
        </div>
      </div>
    </div>
  );
}
