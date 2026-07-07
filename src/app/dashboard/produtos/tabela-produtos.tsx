"use client";

/**
 * Tabela interativa do catálogo: copiar código (1 clique), editar/adicionar
 * via modal único, toggle "em falta" e remover (soft delete).
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  criarProduto,
  atualizarProduto,
  setDisponivel,
  removerProduto,
} from "./actions";
import { CATEGORIAS_PRODUTO, labelCategoria } from "@/lib/categorias-produto";

export type ProdutoRow = {
  id: string;
  codigo_ref: string;
  descricao: string;
  disponivel: boolean;
  apelidos?: string[];
  categoria?: string | null;
};

type ModalState =
  | { aberto: false }
  | { aberto: true; modo: "novo" }
  | { aberto: true; modo: "editar"; produto: ProdutoRow };

export function BotaoNovoProduto() {
  // Reusa o mesmo fluxo do modal da tabela via evento custom simples:
  // renderizamos um modal próprio aqui pra ficar independente da tabela.
  const [modal, setModal] = useState<ModalState>({ aberto: false });
  return (
    <>
      <button
        type="button"
        onClick={() => setModal({ aberto: true, modo: "novo" })}
        className="px-4 py-2.5 rounded-lg bg-laranja hover:bg-laranja-escuro text-white text-sm font-heading font-semibold transition"
      >
        + Novo produto
      </button>
      {modal.aberto && (
        <ProdutoModal
          modo="novo"
          onFechar={() => setModal({ aberto: false })}
        />
      )}
    </>
  );
}

export function TabelaProdutos({ produtos }: { produtos: ProdutoRow[] }) {
  const [modal, setModal] = useState<ModalState>({ aberto: false });

  return (
    <>
      <div className="bg-white rounded-2xl border border-cinza-claro overflow-hidden max-w-4xl">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-offwhite border-b border-cinza-claro text-left text-xs font-heading font-semibold text-cinza-medio uppercase tracking-wider">
              <th className="px-4 py-3 w-28">Código</th>
              <th className="px-4 py-3">Descrição</th>
              <th className="px-4 py-3 w-56 text-right">Ações</th>
            </tr>
          </thead>
          <tbody>
            {produtos.map((p) => (
              <LinhaProduto
                key={p.id}
                produto={p}
                onEditar={() =>
                  setModal({ aberto: true, modo: "editar", produto: p })
                }
              />
            ))}
          </tbody>
        </table>
      </div>
      {modal.aberto && (
        <ProdutoModal
          modo={modal.modo}
          produto={modal.modo === "editar" ? modal.produto : undefined}
          onFechar={() => setModal({ aberto: false })}
        />
      )}
    </>
  );
}

function LinhaProduto({
  produto,
  onEditar,
}: {
  produto: ProdutoRow;
  onEditar: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [copiado, setCopiado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  function copiarCodigo() {
    // navigator.clipboard só existe em contexto seguro (HTTPS/localhost);
    // sem ele (ou se falhar), mostra o código pra cópia manual.
    try {
      if (!navigator.clipboard?.writeText) throw new Error("sem clipboard");
      navigator.clipboard
        .writeText(produto.codigo_ref)
        .then(() => {
          setCopiado(true);
          setTimeout(() => setCopiado(false), 1500);
        })
        .catch(() => window.prompt("Copie o código:", produto.codigo_ref));
    } catch {
      window.prompt("Copie o código:", produto.codigo_ref);
    }
  }

  function run(fn: () => Promise<{ ok?: true; error?: string }>) {
    setErro(null);
    startTransition(async () => {
      const r = await fn();
      if (r && "error" in r && r.error) {
        setErro(r.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <tr
      className={`border-b border-cinza-claro/60 last:border-0 hover:bg-offwhite/60 ${
        !produto.disponivel ? "opacity-60" : ""
      }`}
    >
      <td className="px-4 py-2.5">
        <button
          type="button"
          onClick={copiarCodigo}
          title="Clique pra copiar o código"
          className="font-mono font-bold text-preto hover:text-laranja transition cursor-copy"
        >
          {copiado ? (
            <span className="text-emerald-700">✓ copiado</span>
          ) : (
            produto.codigo_ref
          )}
        </button>
      </td>
      <td className="px-4 py-2.5">
        <span
          className={
            !produto.disponivel ? "line-through text-cinza-medio" : "text-preto"
          }
        >
          {produto.descricao}
        </span>
        {produto.categoria && (
          <span className="ml-2 inline-flex px-1.5 py-0.5 rounded-full text-[10px] font-heading font-semibold bg-offwhite text-cinza-medio border border-cinza-claro">
            {labelCategoria(produto.categoria)}
          </span>
        )}
        {(produto.apelidos?.length ?? 0) > 0 && (
          <span
            className="ml-2 text-[11px] text-cinza-medio"
            title="Apelidos — como o cliente costuma pedir"
          >
            ({produto.apelidos!.join(", ")})
          </span>
        )}
        {!produto.disponivel && (
          <span className="ml-2 inline-flex px-2 py-0.5 rounded-full text-[10px] font-heading font-bold bg-red-50 text-red-700 border border-red-200 uppercase tracking-wider">
            Em falta
          </span>
        )}
        {erro && <p className="text-xs text-red-700 mt-0.5">{erro}</p>}
      </td>
      <td className="px-4 py-2.5 text-right whitespace-nowrap">
        <button
          type="button"
          onClick={onEditar}
          disabled={pending}
          className="text-xs text-cinza-medio hover:text-preto font-heading font-semibold disabled:opacity-50 mr-3"
        >
          Editar
        </button>
        <button
          type="button"
          onClick={() => run(() => setDisponivel(produto.id, !produto.disponivel))}
          disabled={pending}
          className={`text-xs font-heading font-semibold disabled:opacity-50 mr-3 ${
            produto.disponivel
              ? "text-amber-700 hover:text-amber-800"
              : "text-emerald-700 hover:text-emerald-800"
          }`}
        >
          {produto.disponivel ? "Marcar em falta" : "Voltou ao estoque"}
        </button>
        <button
          type="button"
          onClick={() => {
            if (!window.confirm(`Remover "${produto.descricao}" do catálogo?`))
              return;
            run(() => removerProduto(produto.id));
          }}
          disabled={pending}
          className="text-xs text-cinza-medio hover:text-red-700 font-heading font-semibold disabled:opacity-50"
        >
          Remover
        </button>
      </td>
    </tr>
  );
}

function ProdutoModal({
  modo,
  produto,
  onFechar,
}: {
  modo: "novo" | "editar";
  produto?: ProdutoRow;
  onFechar: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [erro, setErro] = useState<string | null>(null);
  const [codigo, setCodigo] = useState(produto?.codigo_ref ?? "");
  const [descricao, setDescricao] = useState(produto?.descricao ?? "");
  const [apelidos, setApelidos] = useState(
    (produto?.apelidos ?? []).join(", "),
  );
  const [categoria, setCategoria] = useState(produto?.categoria ?? "");

  function salvar() {
    if (pending) return; // Enter repetido não dispara double-submit
    setErro(null);
    startTransition(async () => {
      const r =
        modo === "novo"
          ? await criarProduto({
              codigoRef: codigo,
              descricao,
              apelidos,
              categoria,
            })
          : await atualizarProduto(produto!.id, {
              codigoRef: codigo,
              descricao,
              apelidos,
              categoria,
            });
      if ("error" in r && r.error) {
        setErro(r.error);
        return;
      }
      router.refresh();
      onFechar();
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-preto/40 flex items-center justify-center p-4"
      onClick={onFechar}
    >
      <div
        className="bg-white rounded-2xl border border-cinza-claro p-6 w-full max-w-md shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-heading font-bold text-preto mb-4">
          {modo === "novo" ? "Novo produto" : "Editar produto"}
        </h2>
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-heading font-semibold text-cinza-medio uppercase tracking-wider mb-1.5">
              Código de referência
            </label>
            <input
              value={codigo}
              onChange={(e) => setCodigo(e.target.value.toUpperCase())}
              placeholder="ex: LC, 600C, RC"
              autoFocus={modo === "novo"}
              className="w-full px-3 py-2.5 rounded-lg border border-cinza-claro font-mono text-sm focus:outline-none focus:border-laranja transition"
            />
          </div>
          <div>
            <label className="block text-xs font-heading font-semibold text-cinza-medio uppercase tracking-wider mb-1.5">
              Descrição
            </label>
            <input
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              placeholder="ex: Lata Coca Cola 350ml"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  salvar();
                }
              }}
              className="w-full px-3 py-2.5 rounded-lg border border-cinza-claro text-sm focus:outline-none focus:border-laranja transition"
            />
          </div>
          <div>
            <label className="block text-xs font-heading font-semibold text-cinza-medio uppercase tracking-wider mb-1.5">
              Categoria
            </label>
            <select
              value={categoria}
              onChange={(e) => setCategoria(e.target.value)}
              className="w-full px-3 py-2.5 rounded-lg border border-cinza-claro text-sm bg-white focus:outline-none focus:border-laranja transition"
            >
              <option value="">(sem categoria)</option>
              {CATEGORIAS_PRODUTO.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-heading font-semibold text-cinza-medio uppercase tracking-wider mb-1.5">
              Apelidos (como o cliente pede — separados por vírgula)
            </label>
            <input
              value={apelidos}
              onChange={(e) => setApelidos(e.target.value)}
              placeholder="ex: litrão, seiscentos, longneck"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  salvar();
                }
              }}
              className="w-full px-3 py-2.5 rounded-lg border border-cinza-claro text-sm focus:outline-none focus:border-laranja transition"
            />
          </div>
          {erro && (
            <p className="text-sm text-red-800 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {erro}
            </p>
          )}
          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onFechar}
              disabled={pending}
              className="px-4 py-2 rounded-lg border border-cinza-claro text-sm font-heading font-semibold text-cinza-medio hover:text-preto transition"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={salvar}
              disabled={pending}
              className="px-4 py-2 rounded-lg bg-laranja hover:bg-laranja-escuro text-white text-sm font-heading font-semibold disabled:opacity-50 transition"
            >
              {pending ? "Salvando..." : "Salvar"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
