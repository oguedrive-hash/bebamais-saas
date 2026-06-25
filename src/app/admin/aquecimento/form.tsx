"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  adicionarAquecimento,
  pausarReativarAquecimento,
  excluirAquecimento,
  gerarQrAquecimento,
  type PapelAq,
  type AqView,
} from "./actions";

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

function Termometro({ temp }: { temp: AqView["temperatura"] }) {
  const map = {
    frio: { txt: "🔵 Frio", cls: "bg-blue-50 text-blue-700 border-blue-200" },
    esquentando: { txt: "🟡 Esquentando", cls: "bg-amber-50 text-amber-700 border-amber-200" },
    quente: { txt: "🔴 Quente", cls: "bg-red-50 text-red-700 border-red-200" },
  } as const;
  const s = map[temp];
  return (
    <span className={`text-xs font-heading font-bold px-2 py-0.5 rounded-full border ${s.cls}`}>
      {s.txt}
    </span>
  );
}

export function AquecimentoManager({
  organizationId,
  inicial,
  erroInicial,
}: {
  organizationId: string;
  inicial: AqView[];
  erroInicial: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [erro, setErro] = useState<string | null>(erroInicial);
  const [modalAberto, setModalAberto] = useState(false);
  const [qr, setQr] = useState<{ instance: string; base64?: string; pairing?: string | null } | null>(null);

  const [papel, setPapel] = useState<PapelAq>("aquecendo");
  const [numero, setNumero] = useState("");
  const [apelido, setApelido] = useState("");

  const ancoras = inicial.filter((n) => n.papel === "ancora").length;
  const aquecendo = inicial.filter((n) => n.papel === "aquecendo").length;

  function salvar() {
    setErro(null);
    startTransition(async () => {
      const r = await adicionarAquecimento(organizationId, { papel, numero, apelido });
      if ("error" in r) {
        setErro(r.error);
        return;
      }
      setModalAberto(false);
      setNumero("");
      setApelido("");
      router.refresh();
      conectar(r.instance_name); // já abre o QR pra conectar
    });
  }

  function conectar(instance: string) {
    setErro(null);
    setQr({ instance });
    startTransition(async () => {
      const r = await gerarQrAquecimento(instance);
      if ("error" in r) {
        setErro(r.error);
        setQr(null);
        return;
      }
      setQr({ instance, base64: r.base64, pairing: r.pairingCode });
    });
  }

  function pausarReativar(id: string, ativar: boolean) {
    setErro(null);
    startTransition(async () => {
      const r = await pausarReativarAquecimento(organizationId, id, ativar);
      if ("error" in r) setErro(r.error);
      else router.refresh();
    });
  }

  function excluir(id: string, instance: string, label: string) {
    if (!confirm(`Tirar "${label}" do aquecedor? Remove a instância da Evolution.`)) return;
    setErro(null);
    startTransition(async () => {
      const r = await excluirAquecimento(organizationId, id, instance);
      if ("error" in r) setErro(r.error);
      else router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-cinza-medio">
          {aquecendo} aquecendo · {ancoras} âncora(s)
        </p>
        <button
          type="button"
          onClick={() => setModalAberto(true)}
          className="px-4 py-2 rounded-lg bg-laranja hover:bg-laranja-escuro text-white font-heading font-semibold transition"
        >
          + Adicionar número
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
            Nenhum número no aquecedor. Adicione uma <strong>âncora</strong> (número já maduro)
            e os <strong>chips novos</strong> que quer maturar.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {inicial.map((n) => {
            const pausado = n.estado === "pausado";
            const label = n.apelido ?? (n.numero ? `+${n.numero}` : n.instance_name);
            return (
              <section
                key={n.id}
                className="bg-white rounded-2xl border border-cinza-claro p-5 flex items-center justify-between gap-4"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-base font-heading font-bold text-preto">{label}</span>
                    {n.papel === "ancora" ? (
                      <span className="text-xs font-heading font-semibold px-2 py-0.5 rounded-full bg-laranja/10 text-laranja-escuro border border-laranja/20">
                        ⚓ Âncora
                      </span>
                    ) : (
                      <Termometro temp={n.temperatura} />
                    )}
                    <StatusBadge conexao={n.conexao} />
                    {pausado && (
                      <span className="text-xs font-heading font-semibold px-2 py-0.5 rounded-full bg-cinza-claro/50 text-cinza-medio border border-cinza-claro">
                        ⏸ pausado
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-cinza-medio mt-1 truncate">
                    {n.numero ? `+${n.numero}` : "sem número"}
                    {n.papel === "aquecendo" && (
                      <>
                        {" "}· dia {n.dias} · hoje {n.feitoHoje}/{n.alvo}
                      </>
                    )}
                    {n.falhas_seguidas > 0 && <> · {n.falhas_seguidas} falha(s)</>}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
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
                    onClick={() => pausarReativar(n.id, pausado)}
                    disabled={pending}
                    className="px-3 py-2 rounded-lg border border-cinza-claro hover:border-laranja text-sm font-heading font-medium text-preto transition disabled:opacity-50"
                  >
                    {pausado ? "Reativar" : "Pausar"}
                  </button>
                  <button
                    type="button"
                    onClick={() => excluir(n.id, n.instance_name, label)}
                    disabled={pending}
                    className="px-3 py-2 rounded-lg border border-red-200 hover:bg-red-50 text-sm font-heading font-medium text-red-700 transition disabled:opacity-50"
                  >
                    Excluir
                  </button>
                </div>
              </section>
            );
          })}
        </div>
      )}

      {/* Modal: adicionar número */}
      {modalAberto && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl border border-cinza-claro p-6 w-full max-w-md space-y-4">
            <h3 className="text-lg font-heading font-bold text-preto">Adicionar ao aquecedor</h3>
            <div>
              <label className="block text-xs font-heading font-semibold text-cinza-medio mb-1">Papel</label>
              <select
                value={papel}
                onChange={(e) => setPapel(e.target.value as PapelAq)}
                className="w-full px-3 py-2 rounded-lg border border-cinza-claro bg-white text-preto focus:outline-none focus:border-laranja transition"
              >
                <option value="aquecendo">Aquecendo (chip novo, maturar)</option>
                <option value="ancora">Âncora (número já maduro, só aquece)</option>
              </select>
              <p className="text-[11px] text-cinza-medio mt-1">
                <strong>Âncora</strong> = número velho/seu que serve de parceiro (IA off, nunca atende lead).
                <strong> Aquecendo</strong> = chip novo subindo na rampa.
              </p>
            </div>
            <div>
              <label className="block text-xs font-heading font-semibold text-cinza-medio mb-1">Número (com DDD/DDI)</label>
              <input
                value={numero}
                onChange={(e) => setNumero(e.target.value)}
                placeholder="5519981756606"
                className="w-full px-3 py-2 rounded-lg border border-cinza-claro bg-white text-preto placeholder:text-cinza-medio focus:outline-none focus:border-laranja transition"
              />
            </div>
            <div>
              <label className="block text-xs font-heading font-semibold text-cinza-medio mb-1">Apelido (opcional)</label>
              <input
                value={apelido}
                onChange={(e) => setApelido(e.target.value)}
                placeholder="meu pessoal, chip novo 1…"
                className="w-full px-3 py-2 rounded-lg border border-cinza-claro bg-white text-preto placeholder:text-cinza-medio focus:outline-none focus:border-laranja transition"
              />
            </div>
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
                  No celular do número: WhatsApp → Aparelhos conectados → Conectar um aparelho →
                  aponte pro QR. Expira em ~40s; feche e clique “Conectar (QR)” de novo se precisar.
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
