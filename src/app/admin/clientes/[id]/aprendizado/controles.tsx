"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  apagarCapturaAprendizado,
  conectarAprendizado,
  desconectarAprendizado,
  excluirContatoAprendizado,
  importarHistoricoAprendizado,
  situacaoAprendizado,
} from "./actions";

const BOTAO = "rounded-lg px-4 py-2 text-sm font-heading font-semibold transition disabled:opacity-50";
const PRINCIPAL = `${BOTAO} bg-vermelho text-white hover:opacity-90`;
const DISCRETO = `${BOTAO} border border-cinza-claro bg-white text-preto hover:border-preto`;

/**
 * Conectar pelo QR Code (que se renova sozinho, e a tela percebe quando conectou)
 * ou, se já está conectado, o botão de desconectar.
 */
export function PainelConexao({
  organizationId,
  temConexao,
  conectado = false,
}: {
  organizationId: string;
  temConexao: boolean;
  conectado?: boolean;
}) {
  const router = useRouter();
  const [pendente, iniciar] = useTransition();
  const [qr, setQr] = useState<string | null>(null);
  const [codigo, setCodigo] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const abertoRef = useRef(false);

  function pedirQr() {
    setErro(null);
    iniciar(async () => {
      const r = await conectarAprendizado(organizationId);
      if ("error" in r) {
        setErro(r.error);
        return;
      }
      abertoRef.current = true;
      setQr(r.qr);
      setCodigo(r.codigo);
    });
  }

  // Com o QR Code na tela: confere a cada 3 s se conectou e renova o QR a cada 30 s (ele vence em ~40 s).
  useEffect(() => {
    if (!qr) return;
    const situacao = setInterval(async () => {
      const r = await situacaoAprendizado(organizationId);
      if ("estado" in r && r.estado === "open") {
        abertoRef.current = false;
        setQr(null);
        router.refresh();
      }
    }, 3000);
    const renova = setInterval(async () => {
      if (!abertoRef.current) return;
      const r = await conectarAprendizado(organizationId);
      if (!("error" in r) && r.qr) setQr(r.qr);
    }, 30000);
    return () => {
      clearInterval(situacao);
      clearInterval(renova);
    };
  }, [qr, organizationId, router]);

  if (conectado) {
    return (
      <button
        type="button"
        disabled={pendente}
        className={DISCRETO}
        onClick={() => {
          if (
            !window.confirm(
              "Desconectar o WhatsApp da loja do aprendizado?\n\n" +
                "Antes de desconectar, o sistema guarda o que ainda não foi importado. " +
                "O que já foi captado continua aqui; só param de chegar conversas novas.",
            )
          )
            return;
          iniciar(async () => {
            const r = await desconectarAprendizado(organizationId);
            if ("error" in r) window.alert(r.error);
            router.refresh();
          });
        }}
      >
        {pendente ? "Desconectando..." : "Desconectar"}
      </button>
    );
  }

  return (
    <div className="mt-4">
      {!qr ? (
        <button type="button" onClick={pedirQr} disabled={pendente} className={PRINCIPAL}>
          {pendente ? "Gerando o QR Code..." : temConexao ? "Gerar o QR Code de novo" : "Conectar o WhatsApp da loja (só leitura)"}
        </button>
      ) : (
        <div className="flex flex-wrap items-start gap-5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qr} alt="QR Code para conectar o WhatsApp da loja" className="w-56 h-56 border border-cinza-claro rounded-lg bg-white" />
          <ol className="text-sm text-preto space-y-1.5 list-decimal pl-5 max-w-sm">
            <li>No celular da loja, abra o WhatsApp.</li>
            <li>
              Toque nos <strong>três pontinhos</strong> (ou em Configurações, no iPhone) e depois em{" "}
              <strong>Aparelhos conectados</strong> → <strong>Conectar um aparelho</strong>.
            </li>
            <li>Aponte a câmera do celular para este QR Code.</li>
            <li>Pronto: esta tela muda sozinha quando conectar.</li>
            {codigo && (
              <li>
                Ou conecte pelo código: <strong className="font-mono">{codigo}</strong>
              </li>
            )}
          </ol>
        </div>
      )}
      {erro && <p className="text-sm text-red-700 mt-2">{erro}</p>}
    </div>
  );
}

export function BotaoImportar({ organizationId, destaque = false }: { organizationId: string; destaque?: boolean }) {
  const router = useRouter();
  const [pendente, iniciar] = useTransition();
  const [aviso, setAviso] = useState<string | null>(null);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        disabled={pendente}
        className={destaque ? PRINCIPAL : DISCRETO}
        onClick={() =>
          iniciar(async () => {
            setAviso(null);
            const r = await importarHistoricoAprendizado(organizationId);
            if ("error" in r) setAviso(`Não deu certo: ${r.error}`);
            else setAviso(`${r.importadas.toLocaleString("pt-BR")} mensagens novas guardadas (de ${r.lidas.toLocaleString("pt-BR")} lidas).`);
            router.refresh();
          })
        }
      >
        {pendente ? "Trazendo as conversas... (pode levar alguns minutos)" : "Trazer as conversas antigas"}
      </button>
      {aviso && <span className="text-xs text-cinza-medio">{aviso}</span>}
    </div>
  );
}

export function BotaoApagarTudo({ organizationId }: { organizationId: string }) {
  const router = useRouter();
  const [pendente, iniciar] = useTransition();
  return (
    <button
      type="button"
      disabled={pendente}
      className={`${BOTAO} border border-red-300 bg-white text-red-700 hover:bg-red-50`}
      onClick={() => {
        if (!window.confirm("Apagar TODAS as conversas captadas? Não tem como desfazer.")) return;
        iniciar(async () => {
          const r = await apagarCapturaAprendizado(organizationId);
          if ("error" in r) window.alert(r.error);
          router.refresh();
        });
      }}
    >
      {pendente ? "Apagando..." : "Apagar tudo"}
    </button>
  );
}

export function BotaoExcluirContato({ organizationId, conversaJid }: { organizationId: string; conversaJid: string }) {
  const router = useRouter();
  const [pendente, iniciar] = useTransition();
  return (
    <button
      type="button"
      disabled={pendente}
      className="text-xs px-2 py-1 rounded-md border border-cinza-claro text-cinza-medio hover:text-red-700 hover:border-red-300 transition"
      onClick={() => {
        if (!window.confirm("Não captar mais este contato e apagar a conversa dele daqui? (Use para conversa pessoal, fornecedor, família...)")) return;
        iniciar(async () => {
          const r = await excluirContatoAprendizado(organizationId, conversaJid);
          if ("error" in r) window.alert(r.error);
          router.replace("?");
          router.refresh();
        });
      }}
    >
      {pendente ? "..." : "Não captar este contato"}
    </button>
  );
}
