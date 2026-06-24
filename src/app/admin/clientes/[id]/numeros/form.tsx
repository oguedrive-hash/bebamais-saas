"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  adicionarNumero,
  atualizarNumero,
  excluirNumero,
  gerarQrNumero,
  type PapelNumero,
} from "./actions";

type NumeroView = {
  id: string;
  instance_name: string;
  numero: string | null;
  papel: PapelNumero;
  persona_nome: string | null;
  persona_voice_id: string | null;
  prioridade: number;
  estado: string;
  ativo: boolean;
  ia_ativa: boolean;
  numeros_teste: string | null;
  envio_falhando: boolean;
  conexao: string;
};

const PAPEL_LABEL: Record<PapelNumero, string> = {
  atendimento: "Atendimento",
  prospeccao: "Prospecção",
  backup: "Backup",
};

function StatusBadge({ conexao }: { conexao: string }) {
  const map: Record<string, { txt: string; cls: string }> = {
    open: { txt: "🟢 Conectado", cls: "bg-green-50 text-green-700 border-green-200" },
    close: { txt: "🔴 Desconectado", cls: "bg-red-50 text-red-700 border-red-200" },
    connecting: { txt: "🟡 Conectando", cls: "bg-yellow-50 text-yellow-700 border-yellow-200" },
  };
  const s = map[conexao] ?? { txt: "⚪ —", cls: "bg-cinza-claro/40 text-cinza-medio border-cinza-claro" };
  return (
    <span className={`text-xs font-heading font-semibold px-2 py-1 rounded-full border ${s.cls}`}>
      {s.txt}
    </span>
  );
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
  const [pending, startTransition] = useTransition();
  const [erro, setErro] = useState<string | null>(erroInicial);
  const [modalAberto, setModalAberto] = useState(false);
  const [qr, setQr] = useState<{ instance: string; base64?: string; pairing?: string | null } | null>(null);

  // form do modal
  const [papel, setPapel] = useState<PapelNumero>("backup");
  const [numero, setNumero] = useState("");
  const [persona, setPersona] = useState("");
  const [voiceId, setVoiceId] = useState("");
  const [prioridade, setPrioridade] = useState(0);

  // form do modal de EDIÇÃO (número existente)
  const [editando, setEditando] = useState<NumeroView | null>(null);
  const [edPapel, setEdPapel] = useState<PapelNumero>("backup");
  const [edPersona, setEdPersona] = useState("");
  const [edVoice, setEdVoice] = useState("");
  const [edPrio, setEdPrio] = useState(0);
  const [edIaAtiva, setEdIaAtiva] = useState(true);
  const [edNumerosTeste, setEdNumerosTeste] = useState("");

  function abrirEdicao(n: NumeroView) {
    setErro(null);
    setEditando(n);
    setEdPapel(n.papel);
    setEdPersona(n.persona_nome ?? "");
    setEdVoice(n.persona_voice_id ?? "");
    setEdPrio(n.prioridade);
    setEdIaAtiva(n.ia_ativa);
    setEdNumerosTeste(n.numeros_teste ?? "");
  }

  function salvarEdicao() {
    if (!editando) return;
    setErro(null);
    startTransition(async () => {
      const r = await atualizarNumero(organizationId, editando.id, {
        papel: edPapel,
        persona_nome: edPersona.trim(),
        persona_voice_id: edVoice.trim() || null,
        prioridade: edPrio,
        ia_ativa: edIaAtiva,
        numeros_teste: edNumerosTeste.trim() || null,
      });
      if ("error" in r) {
        setErro(r.error);
        return;
      }
      setEditando(null);
      router.refresh();
    });
  }

  function salvar() {
    setErro(null);
    startTransition(async () => {
      const r = await adicionarNumero(organizationId, {
        papel,
        numero,
        persona_nome: persona,
        persona_voice_id: voiceId,
        prioridade,
      });
      if ("error" in r) {
        setErro(r.error);
        return;
      }
      setModalAberto(false);
      setNumero("");
      setPersona("");
      setVoiceId("");
      setPrioridade(0);
      router.refresh();
      // já abre o QR pra conectar o número recém-criado
      conectar(r.instance_name);
    });
  }

  function conectar(instance: string) {
    setErro(null);
    setQr({ instance });
    startTransition(async () => {
      const r = await gerarQrNumero(instance);
      if ("error" in r) {
        setErro(r.error);
        setQr(null);
        return;
      }
      setQr({ instance, base64: r.base64, pairing: r.pairingCode });
    });
  }

  function excluir(id: string, instance: string, label: string) {
    if (!confirm(`Excluir o número "${label}"? Isso remove a instância da Evolution.`)) return;
    setErro(null);
    startTransition(async () => {
      const r = await excluirNumero(organizationId, id, instance);
      if ("error" in r) setErro(r.error);
      else router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-cinza-medio">
          {inicial.length} número(s) no pool
        </p>
        <button
          type="button"
          onClick={() => setModalAberto(true)}
          className="px-4 py-2 rounded-lg bg-laranja hover:bg-laranja-escuro text-white font-heading font-semibold transition"
        >
          + Adicionar atendente
        </button>
      </div>

      {erro && (
        <div className="p-4 rounded-lg bg-red-50 border border-red-200">
          <p className="text-sm text-red-800">{erro}</p>
        </div>
      )}

      {inicial.length === 0 ? (
        <div className="p-8 rounded-2xl border border-dashed border-cinza-claro text-center">
          <p className="text-sm text-cinza-medio">
            Nenhum número cadastrado ainda. Clique em “Adicionar atendente”.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {inicial.map((n) => (
            <section
              key={n.id}
              className="bg-white rounded-2xl border border-cinza-claro p-5 flex items-center justify-between gap-4"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-base font-heading font-bold text-preto">
                    {n.persona_nome ?? "—"}
                  </span>
                  <span className="text-xs font-heading font-semibold px-2 py-0.5 rounded-full bg-laranja/10 text-laranja-escuro border border-laranja/20">
                    {PAPEL_LABEL[n.papel]}
                  </span>
                  <StatusBadge conexao={n.conexao} />
                  {n.envio_falhando && n.conexao === "open" && (
                    <span className="text-xs font-heading font-bold px-2 py-0.5 rounded-full bg-red-50 text-red-700 border border-red-300" title="O número conecta mas o WhatsApp está bloqueando o envio. NÃO reconecte — deixe descansar. Outro número assume os atendimentos.">
                      ⚠️ conectado, sem envio
                    </span>
                  )}
                  {!n.ia_ativa && (
                    <span className="text-xs font-heading font-semibold px-2 py-0.5 rounded-full bg-cinza-claro/50 text-cinza-medio border border-cinza-claro">
                      🔕 IA off
                    </span>
                  )}
                  {n.ia_ativa && n.numeros_teste?.trim() && (
                    <span className="text-xs font-heading font-semibold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
                      🧪 modo teste
                    </span>
                  )}
                  {n.papel === "backup" && (
                    <span className="text-xs text-cinza-medio">prio {n.prioridade}</span>
                  )}
                </div>
                <p className="text-xs text-cinza-medio mt-1 truncate">
                  {n.numero ? `+${n.numero}` : "sem número"} · estado {n.estado}
                  {n.persona_voice_id ? ` · voz ✓` : " · voz —"}
                </p>
                {n.envio_falhando && n.conexao === "open" && (
                  <p className="text-xs text-red-700 mt-1 max-w-md">
                    Conecta mas o WhatsApp está <strong>bloqueando o envio</strong> (restrição temporária). Outro número já assumiu os atendimentos.{" "}
                    <strong>NÃO reconecte</strong> — reconectar piora; deixe descansar (volta sozinho em algumas horas).
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => abrirEdicao(n)}
                  disabled={pending}
                  className="px-3 py-2 rounded-lg border border-cinza-claro hover:border-laranja text-sm font-heading font-medium text-preto transition disabled:opacity-50"
                >
                  Editar
                </button>
                <button
                  type="button"
                  onClick={() => conectar(n.instance_name)}
                  disabled={pending}
                  className="px-3 py-2 rounded-lg border border-cinza-claro hover:border-laranja text-sm font-heading font-medium text-preto transition disabled:opacity-50"
                >
                  Conectar (QR)
                </button>
                <button
                  type="button"
                  onClick={() => excluir(n.id, n.instance_name, n.persona_nome ?? n.instance_name)}
                  disabled={pending}
                  className="px-3 py-2 rounded-lg border border-red-200 hover:bg-red-50 text-sm font-heading font-medium text-red-700 transition disabled:opacity-50"
                >
                  Excluir
                </button>
              </div>
            </section>
          ))}
        </div>
      )}

      {/* Modal: adicionar atendente */}
      {modalAberto && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl border border-cinza-claro p-6 w-full max-w-md space-y-4">
            <h3 className="text-lg font-heading font-bold text-preto">Adicionar atendente</h3>
            <div>
              <label className="block text-xs font-heading font-semibold text-cinza-medio mb-1">Papel</label>
              <select
                value={papel}
                onChange={(e) => setPapel(e.target.value as PapelNumero)}
                className="w-full px-3 py-2 rounded-lg border border-cinza-claro bg-white text-preto focus:outline-none focus:border-laranja transition"
              >
                <option value="atendimento">Atendimento</option>
                <option value="prospeccao">Prospecção</option>
                <option value="backup">Backup</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-heading font-semibold text-cinza-medio mb-1">Número (telefone, com DDD/DDI)</label>
              <input
                value={numero}
                onChange={(e) => setNumero(e.target.value)}
                placeholder="5519981756606"
                className="w-full px-3 py-2 rounded-lg border border-cinza-claro bg-white text-preto placeholder:text-cinza-medio focus:outline-none focus:border-laranja transition"
              />
            </div>
            <div>
              <label className="block text-xs font-heading font-semibold text-cinza-medio mb-1">Persona (nome)</label>
              <input
                value={persona}
                onChange={(e) => setPersona(e.target.value)}
                placeholder="Caio, Yasmin…"
                className="w-full px-3 py-2 rounded-lg border border-cinza-claro bg-white text-preto placeholder:text-cinza-medio focus:outline-none focus:border-laranja transition"
              />
            </div>
            <div>
              <label className="block text-xs font-heading font-semibold text-cinza-medio mb-1">Voice ID (ElevenLabs — opcional)</label>
              <input
                value={voiceId}
                onChange={(e) => setVoiceId(e.target.value)}
                placeholder="cola o ID da voz"
                className="w-full px-3 py-2 rounded-lg border border-cinza-claro bg-white text-preto placeholder:text-cinza-medio focus:outline-none focus:border-laranja transition"
              />
            </div>
            {papel === "backup" && (
              <div>
                <label className="block text-xs font-heading font-semibold text-cinza-medio mb-1">Prioridade (menor entra primeiro)</label>
                <input
                  type="number"
                  value={prioridade}
                  onChange={(e) => setPrioridade(Number(e.target.value) || 0)}
                  className="w-full px-3 py-2 rounded-lg border border-cinza-claro bg-white text-preto focus:outline-none focus:border-laranja transition"
                />
              </div>
            )}
            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setModalAberto(false)}
                disabled={pending}
                className="px-4 py-2 rounded-lg border border-cinza-claro text-sm font-heading font-medium text-cinza-medio transition"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={salvar}
                disabled={pending}
                className="px-4 py-2 rounded-lg bg-laranja hover:bg-laranja-escuro disabled:bg-laranja-claro text-white font-heading font-semibold transition"
              >
                {pending ? "Criando…" : "Criar e conectar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: editar número */}
      {editando && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl border border-cinza-claro p-6 w-full max-w-md space-y-4">
            <h3 className="text-lg font-heading font-bold text-preto">
              Editar {editando.persona_nome ?? "número"}
            </h3>
            <p className="text-xs text-cinza-medio">
              {editando.numero ? `+${editando.numero}` : "sem número"} · instância{" "}
              <span className="font-mono">{editando.instance_name}</span>
            </p>
            <div>
              <label className="block text-xs font-heading font-semibold text-cinza-medio mb-1">Papel</label>
              <select
                value={edPapel}
                onChange={(e) => setEdPapel(e.target.value as PapelNumero)}
                className="w-full px-3 py-2 rounded-lg border border-cinza-claro bg-white text-preto focus:outline-none focus:border-laranja transition"
              >
                <option value="atendimento">Atendimento</option>
                <option value="prospeccao">Prospecção</option>
                <option value="backup">Backup</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-heading font-semibold text-cinza-medio mb-1">Persona (nome)</label>
              <input
                value={edPersona}
                onChange={(e) => setEdPersona(e.target.value)}
                placeholder="Caio, Yasmin…"
                className="w-full px-3 py-2 rounded-lg border border-cinza-claro bg-white text-preto placeholder:text-cinza-medio focus:outline-none focus:border-laranja transition"
              />
            </div>
            <div>
              <label className="block text-xs font-heading font-semibold text-cinza-medio mb-1">Voice ID (ElevenLabs)</label>
              <input
                value={edVoice}
                onChange={(e) => setEdVoice(e.target.value)}
                placeholder="cola o ID da voz"
                className="w-full px-3 py-2 rounded-lg border border-cinza-claro bg-white text-preto placeholder:text-cinza-medio focus:outline-none focus:border-laranja transition"
              />
            </div>
            <div>
              <label className="block text-xs font-heading font-semibold text-cinza-medio mb-1">Prioridade (menor entra primeiro)</label>
              <input
                type="number"
                value={edPrio}
                onChange={(e) => setEdPrio(Number(e.target.value) || 0)}
                className="w-full px-3 py-2 rounded-lg border border-cinza-claro bg-white text-preto focus:outline-none focus:border-laranja transition"
              />
            </div>

            <div className="border-t border-cinza-claro pt-3 space-y-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={edIaAtiva}
                  onChange={(e) => setEdIaAtiva(e.target.checked)}
                  className="w-4 h-4 accent-laranja"
                />
                <span className="text-sm font-heading font-semibold text-preto">IA responde automaticamente</span>
              </label>
              <p className="text-[11px] text-cinza-medio">
                Desligado = número de <strong>uso manual</strong> (a IA não responde ninguém — ex: número de cobrança).
              </p>
              <div className="pt-1">
                <label className="block text-xs font-heading font-semibold text-cinza-medio mb-1">Números de teste</label>
                <input
                  value={edNumerosTeste}
                  onChange={(e) => setEdNumerosTeste(e.target.value)}
                  placeholder="5519998744971, 5511999999999"
                  disabled={!edIaAtiva}
                  className="w-full px-3 py-2 rounded-lg border border-cinza-claro bg-white text-preto placeholder:text-cinza-medio focus:outline-none focus:border-laranja transition disabled:bg-cinza-claro/30"
                />
                <p className="text-[11px] text-cinza-medio mt-1">
                  <strong>Vazio = responde todos</strong> (normal). Preenchido = a IA <strong>só responde esses números</strong> (teus clientes ficam intocados). Separe por vírgula.
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setEditando(null)}
                disabled={pending}
                className="px-4 py-2 rounded-lg border border-cinza-claro text-sm font-heading font-medium text-cinza-medio transition"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={salvarEdicao}
                disabled={pending}
                className="px-4 py-2 rounded-lg bg-laranja hover:bg-laranja-escuro disabled:bg-laranja-claro text-white font-heading font-semibold transition"
              >
                {pending ? "Salvando…" : "Salvar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: QR */}
      {qr && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl border border-cinza-claro p-6 w-full max-w-sm space-y-4 text-center">
            <h3 className="text-lg font-heading font-bold text-preto">Conectar número</h3>
            {qr.base64 ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={qr.base64} alt="QR Code" className="mx-auto w-64 h-64" />
                <p className="text-xs text-cinza-medio">
                  No celular do número: WhatsApp → Aparelhos conectados → Conectar um
                  aparelho → aponte pro QR. Expira em ~40s; feche e clique “Conectar (QR)”
                  de novo se precisar.
                </p>
                {qr.pairing && (
                  <p className="text-xs text-cinza-medio">
                    Ou código: <strong>{qr.pairing}</strong>
                  </p>
                )}
              </>
            ) : (
              <p className="text-sm text-cinza-medio py-8">Gerando QR…</p>
            )}
            <button
              type="button"
              onClick={() => {
                setQr(null);
                router.refresh();
              }}
              className="px-4 py-2 rounded-lg bg-laranja hover:bg-laranja-escuro text-white font-heading font-semibold transition"
            >
              Fechar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
