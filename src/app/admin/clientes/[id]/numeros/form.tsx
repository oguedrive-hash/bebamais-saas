"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  adicionarNumero,
  atualizarNumero,
  estadoConexao,
  excluirNumero,
  gerarQrNumero,
  reconfigurarConexao,
  type NumeroRow,
} from "./actions";

type NumeroView = NumeroRow & { conexao: string };

function Status({ conexao }: { conexao: string }) {
  if (conexao === "open") return <span className="text-sm font-semibold text-green-700">● Conectado</span>;
  if (conexao === "connecting") return <span className="text-sm font-semibold text-yellow-700">● Conectando</span>;
  if (conexao === "close") return <span className="text-sm font-semibold text-red-700">● Desconectado</span>;
  return <span className="text-sm text-cinza-medio">● Sem informação</span>;
}

export function NumerosManager({
  organizationId,
  inicial,
  erroInicial,
}: {
  organizationId: string;
  inicial: NumeroView[];
  erroInicial: string | null;
}) {
  const router = useRouter();
  const [erro, setErro] = useState<string | null>(erroInicial);
  const [aviso, setAviso] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();
  const [novo, setNovo] = useState({ numero: "", apelido: "", nomeAssistente: "" });
  const [qr, setQr] = useState<{ instance: string; base64?: string; pairing?: string | null } | null>(null);

  function rodar(acao: () => Promise<{ ok: true } | { error: string } | { ok: true; instance_name: string }>, ok?: string) {
    setErro(null);
    setAviso(null);
    iniciar(async () => {
      const r = await acao();
      if ("error" in r) setErro(r.error);
      else {
        if (ok) setAviso(ok);
        router.refresh();
      }
    });
  }

  function abrirQr(instance: string) {
    setErro(null);
    iniciar(async () => {
      const r = await gerarQrNumero(instance);
      if ("error" in r) setErro(r.error);
      else setQr({ instance, base64: r.base64, pairing: r.pairingCode });
    });
  }

  // Enquanto o QR está aberto, confere a cada 4s se o número conectou.
  useEffect(() => {
    if (!qr) return;
    const t = setInterval(async () => {
      if ((await estadoConexao(qr.instance)) === "open") {
        setQr(null);
        setAviso("Número conectado!");
        router.refresh();
      }
    }, 4000);
    return () => clearInterval(t);
  }, [qr, router]);

  return (
    <div className="space-y-6">
      {erro && <div className="rounded-lg bg-red-50 border border-red-200 text-red-800 px-4 py-3 text-sm">{erro}</div>}
      {aviso && <div className="rounded-lg bg-green-50 border border-green-200 text-green-800 px-4 py-3 text-sm">{aviso}</div>}

      {inicial.length === 0 && <p className="text-cinza-medio">Nenhum número cadastrado ainda.</p>}

      {inicial.map((n) => (
        <CartaoNumero
          key={n.id}
          n={n}
          pendente={pendente}
          onSalvar={(patch) => rodar(() => atualizarNumero(organizationId, n.id, patch), "Salvo.")}
          onConectar={() => abrirQr(n.instance_name)}
          onReconfigurar={() => rodar(() => reconfigurarConexao(n.instance_name), "Conexão reconfigurada.")}
          onExcluir={() => {
            if (window.confirm(`Excluir o número "${n.apelido ?? n.numero}"? Ele para de receber mensagens no painel.`)) {
              rodar(() => excluirNumero(organizationId, n.id, n.instance_name), "Número excluído.");
            }
          }}
        />
      ))}

      <div className="rounded-2xl border border-cinza-claro bg-white p-5">
        <p className="font-heading font-semibold text-preto mb-3">Adicionar número</p>
        <div className="grid md:grid-cols-3 gap-3">
          <label className="text-sm">
            <span className="block text-cinza-medio mb-1">Telefone com DDD</span>
            <input value={novo.numero} onChange={(e) => setNovo({ ...novo, numero: e.target.value })} placeholder="19 99999-9999" className="w-full rounded-lg border border-cinza-claro px-3 py-2" />
          </label>
          <label className="text-sm">
            <span className="block text-cinza-medio mb-1">Nome curto (aparece para as atendentes)</span>
            <input value={novo.apelido} onChange={(e) => setNovo({ ...novo, apelido: e.target.value })} placeholder="Loja" className="w-full rounded-lg border border-cinza-claro px-3 py-2" />
          </label>
          <label className="text-sm">
            <span className="block text-cinza-medio mb-1">Nome do assistente (opcional)</span>
            <input value={novo.nomeAssistente} onChange={(e) => setNovo({ ...novo, nomeAssistente: e.target.value })} placeholder="Assistente Beba Mais" className="w-full rounded-lg border border-cinza-claro px-3 py-2" />
          </label>
        </div>
        <button
          disabled={pendente}
          onClick={() =>
            rodar(async () => {
              const r = await adicionarNumero(organizationId, novo);
              if ("ok" in r) {
                setNovo({ numero: "", apelido: "", nomeAssistente: "" });
                abrirQr(r.instance_name);
              }
              return r;
            })
          }
          className="mt-4 rounded-lg bg-vermelho text-white px-5 py-2.5 font-heading font-bold disabled:opacity-50"
        >
          Adicionar e conectar
        </button>
      </div>

      {qr && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={() => setQr(null)}>
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full text-center" onClick={(e) => e.stopPropagation()}>
            <p className="font-heading font-bold text-lg mb-2">Conectar o WhatsApp</p>
            <p className="text-sm text-cinza-medio mb-4">
              No celular do número: WhatsApp → Aparelhos conectados → Conectar um aparelho → aponte para o código.
            </p>
            {qr.base64 ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={qr.base64} alt="QR Code" className="mx-auto w-64 h-64" />
            ) : (
              <p className="text-sm">Código ainda não disponível. Feche e tente de novo.</p>
            )}
            {qr.pairing && <p className="mt-3 text-sm">Ou use o código: <strong className="tracking-widest">{qr.pairing}</strong></p>}
            <button onClick={() => setQr(null)} className="mt-5 rounded-lg border border-cinza-claro px-4 py-2 font-semibold">Fechar</button>
          </div>
        </div>
      )}
    </div>
  );
}

function CartaoNumero(props: {
  n: NumeroView;
  pendente: boolean;
  onSalvar: (patch: Partial<NumeroRow>) => void;
  onConectar: () => void;
  onReconfigurar: () => void;
  onExcluir: () => void;
}) {
  const { n } = props;
  const [apelido, setApelido] = useState(n.apelido ?? "");
  const [persona, setPersona] = useState(n.persona_nome ?? "");
  const [testes, setTestes] = useState(n.numeros_teste ?? "");
  return (
    <div className="rounded-2xl border border-cinza-claro bg-white p-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-heading font-bold text-lg text-preto">{n.apelido || "Sem nome"}</p>
          <p className="text-sm text-cinza-medio">{n.numero}</p>
        </div>
        <div className="flex items-center gap-3">
          <Status conexao={n.conexao} />
          {n.conexao !== "open" && (
            <button onClick={props.onConectar} disabled={props.pendente} className="rounded-lg bg-preto text-white px-4 py-2 text-sm font-semibold disabled:opacity-50">
              Conectar (QR Code)
            </button>
          )}
        </div>
      </div>

      <label className="flex items-center gap-3 rounded-lg bg-offwhite px-4 py-3 cursor-pointer">
        <input type="checkbox" checked={n.ia_ativa} onChange={(e) => props.onSalvar({ ia_ativa: e.target.checked })} className="h-5 w-5" />
        <span>
          <span className="font-semibold">Assistente responde neste número</span>
          <span className="block text-sm text-cinza-medio">Desligado: as mensagens vão direto para a fila das atendentes.</span>
        </span>
      </label>

      <div className="grid md:grid-cols-2 gap-3">
        <label className="text-sm">
          <span className="block text-cinza-medio mb-1">Nome curto</span>
          <input value={apelido} onChange={(e) => setApelido(e.target.value)} className="w-full rounded-lg border border-cinza-claro px-3 py-2" />
        </label>
        <label className="text-sm">
          <span className="block text-cinza-medio mb-1">Nome do assistente</span>
          <input value={persona} onChange={(e) => setPersona(e.target.value)} placeholder="Assistente virtual" className="w-full rounded-lg border border-cinza-claro px-3 py-2" />
        </label>
      </div>
      <label className="text-sm block">
        <span className="block text-cinza-medio mb-1">
          Modo teste: o assistente só responde estes telefones (separe por vírgula). Deixe vazio para responder todos.
        </span>
        <input value={testes} onChange={(e) => setTestes(e.target.value)} placeholder="19999998888, 19988887777" className="w-full rounded-lg border border-cinza-claro px-3 py-2" />
      </label>

      <div className="flex flex-wrap gap-2 justify-between">
        <button
          onClick={() => props.onSalvar({ apelido: apelido.trim() || null, persona_nome: persona.trim() || null, numeros_teste: testes.trim() || null })}
          disabled={props.pendente}
          className="rounded-lg bg-vermelho text-white px-4 py-2 text-sm font-heading font-bold disabled:opacity-50"
        >
          Salvar
        </button>
        <div className="flex gap-2">
          <button onClick={props.onReconfigurar} disabled={props.pendente} className="rounded-lg border border-cinza-claro px-3 py-2 text-sm">
            Reconfigurar conexão
          </button>
          <button onClick={props.onExcluir} disabled={props.pendente} className="rounded-lg border border-red-200 text-red-700 px-3 py-2 text-sm">
            Excluir
          </button>
        </div>
      </div>
    </div>
  );
}
