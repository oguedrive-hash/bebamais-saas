import { createClient } from "@/lib/supabase/server";

/**
 * Catálogo de produtos — consulta rápida do atendente ("temos isso?").
 * Importado da planilha do cliente (código de referência + descrição).
 * SEM preço de propósito: cotação é sempre da equipe (decisão de 02/07).
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
    .select("id, codigo_ref, descricao")
    .eq("ativo", true)
    .order("descricao", { ascending: true })
    .limit(200);

  if (termo) {
    const p = `%${termo.replace(/[%_]/g, "")}%`;
    query = query.or(`descricao.ilike.${p},codigo_ref.ilike.${p}`);
  }

  const { data: produtos, count } = await query;
  const { count: total } = await supabase
    .from("produtos")
    .select("id", { count: "exact", head: true })
    .eq("ativo", true);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-heading font-bold text-preto">Produtos</h1>
        <p className="text-sm text-cinza-medio mt-1">
          Catálogo com {total ?? 0} itens — consulta rápida do que a loja
          trabalha. Preços e cotação: com a equipe.
        </p>
      </div>

      <form method="get" className="mb-6 flex gap-3 max-w-xl">
        <input
          name="busca"
          defaultValue={termo}
          placeholder="Buscar por descrição ou código (ex: skol, 600C, agua...)"
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

      {!produtos || produtos.length === 0 ? (
        <div className="bg-white rounded-2xl border border-cinza-claro p-10 text-center">
          <p className="text-sm text-cinza-medio">
            {termo
              ? `Nada encontrado pra "${termo}" — tenta outra palavra (ex: só "coca" em vez de "coca cola 2l").`
              : "Nenhum produto no catálogo ainda."}
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-cinza-claro overflow-hidden max-w-3xl">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-offwhite border-b border-cinza-claro text-left text-xs font-heading font-semibold text-cinza-medio uppercase tracking-wider">
                <th className="px-4 py-3 w-28">Código</th>
                <th className="px-4 py-3">Descrição</th>
              </tr>
            </thead>
            <tbody>
              {produtos.map((p) => (
                <tr
                  key={p.id}
                  className="border-b border-cinza-claro/60 last:border-0 hover:bg-offwhite/60"
                >
                  <td className="px-4 py-2.5 font-mono font-bold text-preto">
                    {p.codigo_ref}
                  </td>
                  <td className="px-4 py-2.5 text-preto">{p.descricao}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {(produtos.length === 200 || (count ?? 0) > 200) && (
            <p className="px-4 py-2.5 text-xs text-cinza-medio bg-offwhite border-t border-cinza-claro">
              Mostrando os primeiros 200 — refina a busca pra achar mais rápido.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
