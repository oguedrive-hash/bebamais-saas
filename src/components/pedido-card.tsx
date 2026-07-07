"use client";

/**
 * Card do PEDIDO estruturado (extraído pela IA da conversa).
 * Usado na fila (/dashboard/pedidos) e no detalhe do contato.
 * Edição estruturada (linhas produto/qtd) — nada de JSON cru: atendente
 * não é técnico. Editar seta editado_pelo_painel (extrator para de mexer).
 */

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ItemPedido } from "@/lib/caio/extrator-pedido";
import {
  assumirPedido,
  finalizarPedido,
  cancelarPedido,
  atualizarPedido,
} from "@/app/dashboard/pedidos/actions";
import { buscarProdutosAtivos } from "@/app/dashboard/produtos/actions";

export type PedidoRow = {
  id: string;
  status: string;
  itens: ItemPedido[];
  modalidade: string | null;
  endereco: string | null;
  nome_cliente: string | null;
  obs: string | null;
  confirmado_em?: string | null;
  created_at: string;
  updated_at: string;
  assumido_por?: string | null;
};

const STATUS_PEDIDO: Record<
  string,
  { label: string; cor: string; bg: string; border: string }
> = {
  captando: {
    label: "IA anotando",
    cor: "text-sky-700",
    bg: "bg-sky-50",
    border: "border-sky-200",
  },
  pronto_para_equipe: {
    label: "Pronto pra finalizar",
    cor: "text-laranja-escuro",
    bg: "bg-laranja/10",
    border: "border-laranja",
  },
  em_atendimento: {
    label: "Com o atendente",
    cor: "text-violet-700",
    bg: "bg-violet-50",
    border: "border-violet-200",
  },
  finalizado: {
    label: "Finalizado",
    cor: "text-emerald-700",
    bg: "bg-emerald-50",
    border: "border-emerald-200",
  },
  cancelado: {
    label: "Cancelado",
    cor: "text-cinza-medio",
    bg: "bg-offwhite",
    border: "border-cinza-claro",
  },
};

export function PedidoStatusBadge({ status }: { status: string }) {
  const cfg = STATUS_PEDIDO[status] ?? STATUS_PEDIDO.captando;
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-heading font-semibold border ${cfg.bg} ${cfg.cor} ${cfg.border}`}
    >
      {cfg.label}
    </span>
  );
}

const ABERTOS = ["captando", "pronto_para_equipe", "em_atendimento"];

export function PedidoCard({
  pedido,
  linkConversa,
  compacto = false,
}: {
  pedido: PedidoRow;
  /** se informado, mostra link "Ver conversa" (usado na fila) */
  linkConversa?: string;
  /** versão compacta pro histórico (sem ações/edição) */
  compacto?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editando, setEditando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  // Estado de edição
  const [itens, setItens] = useState<ItemPedido[]>(pedido.itens ?? []);
  const [modalidade, setModalidade] = useState<string>(pedido.modalidade ?? "");
  const [endereco, setEndereco] = useState(pedido.endereco ?? "");
  const [obs, setObs] = useState(pedido.obs ?? "");

  const aberto = ABERTOS.includes(pedido.status);

  // updated_at que o painel viu quando a edição abriu — vai como CAS pro save
  const [updatedAtEdicao, setUpdatedAtEdicao] = useState(pedido.updated_at);

  function run(fn: () => Promise<{ ok?: true; error?: string }>) {
    setErro(null);
    startTransition(async () => {
      try {
        const r = await fn();
        if (r && "error" in r && r.error) {
          setErro(r.error);
          return;
        }
        setEditando(false);
        router.refresh();
      } catch {
        // Rejeição de rede/exception: sem isso o clique falha em silêncio e o
        // atendente não sabe se salvou.
        setErro("Falha de conexão — tente de novo.");
      }
    });
  }

  function salvarEdicao() {
    const limpos = itens.filter((i) => i.produto.trim());
    if (limpos.length === 0) {
      setErro(
        "O pedido precisa de ao menos 1 item — pra descartar, use Cancelar pedido.",
      );
      return;
    }
    run(() =>
      atualizarPedido(
        pedido.id,
        {
          itens: limpos,
          modalidade: (modalidade || null) as "retirada" | "entrega" | null,
          endereco: endereco || null,
          obs: obs || null,
        },
        updatedAtEdicao,
      ),
    );
  }

  return (
    <div
      className={`rounded-2xl border p-4 ${
        pedido.status === "pronto_para_equipe"
          ? "border-laranja bg-laranja/5"
          : "border-cinza-claro bg-white"
      }`}
    >
      <div className="flex items-center justify-between gap-2 mb-3">
        <PedidoStatusBadge status={pedido.status} />
        <div className="flex items-center gap-3">
          {linkConversa && (
            <Link
              href={linkConversa}
              className="text-xs text-laranja hover:text-laranja-escuro font-heading font-semibold"
            >
              Ver conversa →
            </Link>
          )}
          {aberto && !compacto && !editando && (
            <button
              type="button"
              onClick={() => {
                // Repopula do prop ATUAL — o realtime dá router.refresh() a cada
                // mensagem e o estado inicial do mount fica stale (salvaria um
                // snapshot velho por cima do pedido atualizado).
                setItens(pedido.itens ?? []);
                setModalidade(pedido.modalidade ?? "");
                setEndereco(pedido.endereco ?? "");
                setObs(pedido.obs ?? "");
                setUpdatedAtEdicao(pedido.updated_at);
                setEditando(true);
              }}
              disabled={pending}
              className="text-xs text-cinza-medio hover:text-preto font-heading font-semibold disabled:opacity-50"
            >
              Editar
            </button>
          )}
        </div>
      </div>

      {!editando ? (
        <>
          {(pedido.itens ?? []).length === 0 ? (
            <p className="text-sm text-cinza-medio">
              Nenhum item anotado ainda.
            </p>
          ) : (
            <ul className="space-y-1 mb-3">
              {pedido.itens.map((i, idx) => (
                <li key={idx} className="text-sm text-preto">
                  <span className="font-heading font-bold">
                    {i.quantidade}
                    {i.unidade ? ` ${i.unidade}` : "x"}
                  </span>{" "}
                  {i.produto}
                  {i.ref && (
                    <span
                      title="Código do catálogo — clique pra copiar"
                      onClick={() =>
                        navigator.clipboard?.writeText(i.ref!).catch(() => {})
                      }
                      className="ml-1.5 inline-flex px-1.5 py-0.5 rounded font-mono text-[10px] font-bold text-laranja-escuro bg-laranja/10 border border-laranja/30 cursor-copy align-middle"
                    >
                      {i.ref}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}

          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-cinza-medio mb-1">
            <span>
              {pedido.modalidade === "entrega"
                ? `🛵 Entrega${pedido.endereco ? ` — ${pedido.endereco}` : ""}`
                : pedido.modalidade === "retirada"
                  ? "🏪 Retirada na loja"
                  : "Retirada/entrega a definir"}
            </span>
            {pedido.nome_cliente && <span>👤 {pedido.nome_cliente}</span>}
          </div>
          {pedido.obs && (
            <p className="text-xs text-cinza-medio italic mt-1">{pedido.obs}</p>
          )}
        </>
      ) : (
        <div className="space-y-2 mb-3">
          {itens.map((item, idx) => (
            <div key={idx} className="flex items-center gap-2">
              <input
                type="number"
                min={1}
                value={item.quantidade}
                onChange={(e) =>
                  setItens((s) =>
                    s.map((it, i) =>
                      i === idx
                        ? { ...it, quantidade: Number(e.target.value) || 1 }
                        : it,
                    ),
                  )
                }
                className="w-16 px-2 py-1.5 border border-cinza-claro rounded-lg text-sm text-right"
              />
              <input
                value={item.unidade ?? ""}
                placeholder="un."
                onChange={(e) =>
                  setItens((s) =>
                    s.map((it, i) =>
                      i === idx ? { ...it, unidade: e.target.value || null } : it,
                    ),
                  )
                }
                className="w-20 px-2 py-1.5 border border-cinza-claro rounded-lg text-sm"
              />
              <ProdutoAutocomplete
                valor={item.produto}
                temRef={!!item.ref}
                onMudar={(texto) =>
                  setItens((s) =>
                    s.map((it, i) =>
                      // digitou por cima → solta o vínculo com o catálogo
                      i === idx ? { ...it, produto: texto, ref: null } : it,
                    ),
                  )
                }
                onEscolher={(p) =>
                  setItens((s) =>
                    s.map((it, i) =>
                      i === idx
                        ? { ...it, produto: p.descricao, ref: p.codigo_ref }
                        : it,
                    ),
                  )
                }
              />
              <button
                type="button"
                onClick={() => setItens((s) => s.filter((_, i) => i !== idx))}
                className="text-cinza-medio hover:text-red-600 text-sm"
                aria-label="Remover item"
              >
                ✕
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() =>
              setItens((s) => [...s, { produto: "", quantidade: 1, unidade: null }])
            }
            className="text-xs text-laranja hover:text-laranja-escuro font-heading font-semibold"
          >
            + Adicionar item
          </button>

          <div className="flex gap-2 pt-1">
            <select
              value={modalidade}
              onChange={(e) => setModalidade(e.target.value)}
              className="px-2 py-1.5 border border-cinza-claro rounded-lg text-sm bg-white"
            >
              <option value="">A definir</option>
              <option value="retirada">Retirada</option>
              <option value="entrega">Entrega</option>
            </select>
            {modalidade === "entrega" && (
              <input
                value={endereco}
                placeholder="Endereço de entrega"
                onChange={(e) => setEndereco(e.target.value)}
                className="flex-1 px-2 py-1.5 border border-cinza-claro rounded-lg text-sm"
              />
            )}
          </div>
          <input
            value={obs}
            placeholder="Observações (opcional)"
            onChange={(e) => setObs(e.target.value)}
            className="w-full px-2 py-1.5 border border-cinza-claro rounded-lg text-sm"
          />
          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              onClick={salvarEdicao}
              disabled={pending}
              className="px-3 py-1.5 rounded-lg bg-laranja hover:bg-laranja-escuro text-white text-xs font-heading font-semibold disabled:opacity-50"
            >
              {pending ? "Salvando..." : "Salvar"}
            </button>
            <button
              type="button"
              onClick={() => setEditando(false)}
              disabled={pending}
              className="px-3 py-1.5 rounded-lg border border-cinza-claro text-xs font-heading font-semibold text-cinza-medio hover:text-preto"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {erro && (
        <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-2 py-1.5 mb-2">
          {erro}
        </p>
      )}

      {aberto && !compacto && !editando && (
        <div className="flex items-center gap-2 pt-2 border-t border-cinza-claro/60 mt-2">
          {pedido.status !== "em_atendimento" && (
            <button
              type="button"
              onClick={() => run(() => assumirPedido(pedido.id))}
              disabled={pending}
              className="px-3 py-1.5 rounded-lg bg-preto hover:bg-chumbo text-white text-xs font-heading font-semibold disabled:opacity-50"
            >
              Assumir
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              // Ação terminal sem "reabrir" — merece confirmação (o Cancelar
              // já tem o prompt de motivo).
              if (!window.confirm("Finalizar este pedido? Ele sai da fila e o contato é marcado como Pedido concluído.")) return;
              run(() => finalizarPedido(pedido.id, { marcarLeadFechou: true }));
            }}
            disabled={pending}
            className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-heading font-semibold disabled:opacity-50"
          >
            ✓ Finalizado
          </button>
          <button
            type="button"
            onClick={() => {
              const motivo = window.prompt("Motivo do cancelamento (opcional):");
              if (motivo === null) return; // Esc/Cancelar aborta a ação
              run(() => cancelarPedido(pedido.id, motivo || undefined));
            }}
            disabled={pending}
            className="px-3 py-1.5 rounded-lg border border-cinza-claro text-xs font-heading font-semibold text-cinza-medio hover:text-red-700 hover:border-red-300 disabled:opacity-50"
          >
            Cancelar pedido
          </button>
        </div>
      )}
    </div>
  );
}

function ProdutoAutocomplete({
  valor,
  temRef,
  onMudar,
  onEscolher,
}: {
  valor: string;
  temRef: boolean;
  onMudar: (texto: string) => void;
  onEscolher: (p: { codigo_ref: string; descricao: string }) => void;
}) {
  const [sugestoes, setSugestoes] = useState<
    { codigo_ref: string; descricao: string }[]
  >([]);
  const [aberto, setAberto] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const escolhendo = useRef(false);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  function buscar(texto: string) {
    if (timer.current) clearTimeout(timer.current);
    if (texto.trim().length < 2) {
      setSugestoes([]);
      setAberto(false);
      return;
    }
    timer.current = setTimeout(async () => {
      try {
        const r = await buscarProdutosAtivos(texto);
        setSugestoes(r);
        setAberto(r.length > 0);
      } catch {
        setSugestoes([]);
      }
    }, 250);
  }

  return (
    <div className="relative flex-1">
      <input
        value={valor}
        placeholder="produto (busca no catálogo)"
        onChange={(e) => {
          onMudar(e.target.value);
          buscar(e.target.value);
        }}
        onBlur={() => {
          // Cancela busca pendente — senão o debounce (250ms) reabre o
          // dropdown DEPOIS do blur, por cima dos campos vizinhos.
          if (timer.current) clearTimeout(timer.current);
          // dá tempo do clique na sugestão disparar antes de fechar
          setTimeout(() => {
            if (!escolhendo.current) setAberto(false);
            escolhendo.current = false;
          }, 150);
        }}
        className={`w-full px-2 py-1.5 border rounded-lg text-sm ${
          temRef ? "border-laranja/50 bg-laranja/5" : "border-cinza-claro"
        }`}
      />
      {temRef && (
        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-mono text-laranja-escuro">
          ✓ catálogo
        </span>
      )}
      {aberto && sugestoes.length > 0 && (
        <ul className="absolute z-20 mt-1 w-full bg-white border border-cinza-claro rounded-lg shadow-lg overflow-hidden">
          {sugestoes.map((s) => (
            <li key={s.codigo_ref}>
              <button
                type="button"
                onMouseDown={() => {
                  escolhendo.current = true;
                }}
                onClick={() => {
                  // cancela busca em voo — senão o debounce reabre o dropdown
                  // com resultados velhos por cima da escolha
                  if (timer.current) clearTimeout(timer.current);
                  onEscolher(s);
                  setAberto(false);
                  setSugestoes([]);
                }}
                className="w-full text-left px-3 py-2 text-sm hover:bg-laranja/5 flex items-center gap-2"
              >
                <span className="font-mono font-bold text-laranja-escuro text-xs w-14 shrink-0">
                  {s.codigo_ref}
                </span>
                <span className="truncate">{s.descricao}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
