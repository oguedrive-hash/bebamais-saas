import { createClient } from "@/lib/supabase/server";
import { CATEGORIAS_PRODUTO } from "@/lib/categorias-produto";
import {
  TabelaProdutos,
  BotaoNovoProduto,
  type ProdutoRow,
} from "./tabela-produtos";
import { BotaoImportarPlanilha } from "./importar-planilha";

/**
 * Catálogo de produtos — consulta rápida do atendente ("temos isso?").
 * Importado da planilha do cliente (código de referência + descrição).
 * SEM preço de propósito: cotação é sempre da equipe (decisão de 02/07).
 * Busca multi-palavra: "coca 2l retor" acha "Coca Cola 2L - Retornavel".
 */

const PER_PAGE = 100;

export default async function ProdutosPage({
  searchParams,
}: {
  searchParams: Promise<{ busca?: string; cat?: string; page?: string }>;
}) {
  const params = await searchParams;
  const termo = params.busca?.trim() ?? "";
  const cat = CATEGORIAS_PRODUTO.some((c) => c.value === params.cat)
    ? params.cat!
    : "";
  const page = Math.max(1, parseInt(params.page ?? "1", 10) || 1);
  const offset = (page - 1) * PER_PAGE;
  const supabase = await createClient();

  let query = supabase
    .from("produtos")
    .select("id, codigo_ref, descricao, disponivel, apelidos, categoria", {
      count: "exact",
    })
    .eq("ativo", true)
    .order("descricao", { ascending: true })
    .range(offset, offset + PER_PAGE - 1);
  if (cat) query = query.eq("categoria", cat);

  // Sanitiza só WILDCARDS (%_*\) — vírgula/parênteses são dados reais do
  // catálogo ("1,5L") e só são problema dentro do .or() (tree do PostgREST),
  // não no .ilike() (valor URL-encodado). Então: termo simples e sem
  // vírgula/parênteses → .or() em descrição+código; qualquer outro caso →
  // cadeia de .ilike() na descrição (AND, qualquer ordem).
  const palavras = termo
    .split(/\s+/)
    .map((w) => w.replace(/[%_*\\]/g, ""))
    .filter(Boolean);
  const buscaInvalida = termo.length > 0 && palavras.length === 0;

  if (palavras.length === 1 && !/[,()]/.test(palavras[0])) {
    query = query.or(
      `descricao.ilike.%${palavras[0]}%,codigo_ref.ilike.%${palavras[0]}%`,
    );
  } else if (palavras.length >= 1) {
    for (const w of palavras) {
      query = query.ilike("descricao", `%${w}%`);
    }
  }

  const { data, count: totalFiltro } = await query;
  const produtos = (data ?? []) as ProdutoRow[];
  const totalPages = Math.max(1, Math.ceil((totalFiltro ?? 0) / PER_PAGE));

  const { count: total } = await supabase
    .from("produtos")
    .select("id", { count: "exact", head: true })
    .eq("ativo", true);
  const { count: emFalta } = await supabase
    .from("produtos")
    .select("id", { count: "exact", head: true })
    .eq("ativo", true)
    .eq("disponivel", false);

  return (
    <div>
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <h1 className="text-2xl font-heading font-bold text-preto">
            Produtos
          </h1>
          <p className="text-sm text-cinza-medio mt-1">
            Catálogo com {total ?? 0} itens
            {(emFalta ?? 0) > 0 ? ` (${emFalta} em falta)` : ""} — clique no
            código pra copiar. Preços e cotação: com a equipe.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <BotaoImportarPlanilha />
          <BotaoNovoProduto />
        </div>
      </div>

      <form method="get" className="mb-4 flex gap-3 max-w-2xl">
        <input
          name="busca"
          defaultValue={termo}
          placeholder="Buscar: descrição, código ou várias palavras (coca 2l retor)"
          autoFocus
          className="flex-1 px-4 py-2.5 rounded-lg border border-cinza-claro bg-white text-sm focus:outline-none focus:border-laranja transition"
        />
        <select
          name="cat"
          defaultValue={cat}
          className="px-3 py-2.5 rounded-lg border border-cinza-claro bg-white text-sm focus:outline-none focus:border-laranja transition"
        >
          <option value="">Todas as categorias</option>
          {CATEGORIAS_PRODUTO.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="px-4 py-2.5 rounded-lg bg-preto hover:bg-chumbo text-white text-sm font-heading font-semibold transition"
        >
          Buscar
        </button>
      </form>

      {buscaInvalida ? (
        <div className="bg-white rounded-2xl border border-cinza-claro p-10 text-center max-w-4xl">
          <p className="text-sm text-cinza-medio">
            Busca inválida — usa letras ou números (ex: skol, 600C, 1,5).
          </p>
        </div>
      ) : produtos.length === 0 ? (
        <div className="bg-white rounded-2xl border border-cinza-claro p-10 text-center max-w-4xl">
          <p className="text-sm text-cinza-medio">
            {termo
              ? `Nada encontrado pra "${termo}" — tenta menos palavras ou parte do nome.`
              : "Nenhum produto no catálogo ainda."}
          </p>
        </div>
      ) : (
        <>
          <TabelaProdutos produtos={produtos} />
          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-3 max-w-4xl px-1">
              <p className="text-xs text-cinza-medio">
                Mostrando <strong>{offset + 1}</strong>–
                <strong>{offset + produtos.length}</strong> de{" "}
                <strong>{totalFiltro}</strong>
              </p>
              <div className="flex items-center gap-1">
                {page > 1 ? (
                  <a
                    href={hrefPagina(termo, cat, page - 1)}
                    className="px-3 py-1.5 text-xs rounded-lg bg-white border border-cinza-claro hover:border-laranja hover:text-laranja transition"
                  >
                    ‹ Anterior
                  </a>
                ) : (
                  <span className="px-3 py-1.5 text-xs text-cinza-medio rounded-lg bg-offwhite border border-cinza-claro opacity-50">
                    ‹ Anterior
                  </span>
                )}
                <span className="px-3 text-xs text-cinza-medio">
                  Página {page} de {totalPages}
                </span>
                {page < totalPages ? (
                  <a
                    href={hrefPagina(termo, cat, page + 1)}
                    className="px-3 py-1.5 text-xs rounded-lg bg-white border border-cinza-claro hover:border-laranja hover:text-laranja transition"
                  >
                    Próxima ›
                  </a>
                ) : (
                  <span className="px-3 py-1.5 text-xs text-cinza-medio rounded-lg bg-offwhite border border-cinza-claro opacity-50">
                    Próxima ›
                  </span>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function hrefPagina(busca: string, cat: string, page: number): string {
  const sp = new URLSearchParams();
  if (busca) sp.set("busca", busca);
  if (cat) sp.set("cat", cat);
  if (page > 1) sp.set("page", String(page));
  const qs = sp.toString();
  return qs ? `/dashboard/produtos?${qs}` : "/dashboard/produtos";
}
