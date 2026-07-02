import { createClient } from "@/lib/supabase/server";
import {
  TabelaProdutos,
  BotaoNovoProduto,
  type ProdutoRow,
} from "./tabela-produtos";

/**
 * Catálogo de produtos — consulta rápida do atendente ("temos isso?").
 * Importado da planilha do cliente (código de referência + descrição).
 * SEM preço de propósito: cotação é sempre da equipe (decisão de 02/07).
 * Busca multi-palavra: "coca 2l retor" acha "Coca Cola 2L - Retornavel".
 */

export default async function ProdutosPage({
  searchParams,
}: {
  searchParams: Promise<{ busca?: string }>;
}) {
  const params = await searchParams;
  const termo = params.busca?.trim() ?? "";
  const supabase = await createClient();

  let query = supabase
    .from("produtos")
    .select("id, codigo_ref, descricao, disponivel")
    .eq("ativo", true)
    .order("descricao", { ascending: true })
    .limit(200);

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

  const { data } = await query;
  const produtos = (data ?? []) as ProdutoRow[];

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
      <div className="flex items-start justify-between gap-4 mb-6">
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
        <BotaoNovoProduto />
      </div>

      <form method="get" className="mb-6 flex gap-3 max-w-xl">
        <input
          name="busca"
          defaultValue={termo}
          placeholder="Buscar: descrição, código ou várias palavras (coca 2l retor)"
          autoFocus
          className="flex-1 px-4 py-2.5 rounded-lg border border-cinza-claro bg-white text-sm focus:outline-none focus:border-laranja transition"
        />
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
          {produtos.length === 200 && (
            <p className="mt-2 text-xs text-cinza-medio max-w-4xl">
              Mostrando os primeiros 200 — refina a busca pra achar mais rápido.
            </p>
          )}
        </>
      )}
    </div>
  );
}
