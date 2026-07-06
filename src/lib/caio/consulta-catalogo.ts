/**
 * Consulta do catálogo por CATEGORIA pra resposta do LLM.
 *
 * Problema que resolve: cliente pergunta "quais cervejas vocês têm?" e a IA
 * respondia "não consigo informar" — o catálogo (produtos.categoria, backfill
 * via LLM) tem a resposta. As descrições NÃO carregam a categoria ("Skol
 * Lata" não contém "cerveja"), então busca textual não serve.
 *
 * Quando a última mensagem do lead menciona uma categoria conhecida, injeta
 * os itens DISPONÍVEIS daquela categoria como bloco de contexto — o LLM
 * responde com marcas reais em vez de inventar ou se recusar.
 */

import { createAdminClient } from "@/lib/supabase/admin";

// Léxico categoria → regex de menção (pt-BR coloquial). Ordem importa:
// "água de coco" precisa casar antes de "água".
const LEXICO: { categoria: string; label: string; regex: RegExp }[] = [
  { categoria: "agua_de_coco", label: "Águas de coco", regex: /\bagua\s+de\s+coco\b|\bcoco\b/i },
  { categoria: "cerveja", label: "Cervejas", regex: /\bcervej\w*|\bbrej\w*|\bchop\w*/i },
  { categoria: "refrigerante", label: "Refrigerantes", regex: /\brefri\w*|\brefrigerante\w*/i },
  { categoria: "agua", label: "Águas", regex: /\bagua\w*/i },
  { categoria: "suco", label: "Sucos", regex: /\bsuco\w*/i },
  { categoria: "energetico", label: "Energéticos", regex: /\benergetic\w*|\bred\s*bull\b|\bmonster\b/i },
  { categoria: "isotonico", label: "Isotônicos", regex: /\bisotonic\w*|\bgatorade\b/i },
  { categoria: "cha", label: "Chás", regex: /\bcha\b|\bchas\b|\bcha\s+gelado\b/i },
  { categoria: "whisky", label: "Whiskys", regex: /\bwhisk\w*|\buisque\w*/i },
  { categoria: "vodka", label: "Vodkas", regex: /\bvodka\w*/i },
  { categoria: "gin", label: "Gins", regex: /\bgin\b|\bgins\b|\bgim\b/i },
  { categoria: "cachaca", label: "Cachaças", regex: /\bcachac\w*|\bpinga\w*/i },
  { categoria: "rum", label: "Runs", regex: /\brum\b|\bruns\b/i },
  { categoria: "tequila", label: "Tequilas", regex: /\btequila\w*/i },
  { categoria: "licor", label: "Licores", regex: /\blicor\w*/i },
  { categoria: "conhaque", label: "Conhaques", regex: /\bconhaque\w*|\bcognac\w*/i },
  { categoria: "aperitivo", label: "Aperitivos", regex: /\baperitivo\w*|\bcampari\b|\baperol\b|\bvermute\w*/i },
  { categoria: "vinho", label: "Vinhos", regex: /\bvinho\w*|\bsidra\w*/i },
  { categoria: "espumante", label: "Espumantes", regex: /\bespumante\w*|\bchampagne\b|\bchandon\b|\bprosecco\b/i },
  { categoria: "ice_e_prontos", label: "Ice e drinks prontos", regex: /\bice\b|\bices\b|\bcorote\b|\bbeats\b/i },
  { categoria: "gelo", label: "Gelo", regex: /\bgelo\w*/i },
  { categoria: "carvao", label: "Carvão", regex: /\bcarv[aã]o\b|\bchurrasco\b/i },
];

function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

/** Categorias do catálogo mencionadas no texto (máx 3, na ordem do léxico). */
export function categoriasMencionadas(texto: string | null): string[] {
  if (!texto?.trim()) return [];
  const t = normalizar(texto);
  const achadas: string[] = [];
  for (const { categoria, regex } of LEXICO) {
    if (achadas.length >= 3) break;
    if (regex.test(t)) achadas.push(categoria);
  }
  // "água de coco" também casa o regex de "agua" — dedup por precedência
  if (achadas.includes("agua_de_coco")) {
    const i = achadas.indexOf("agua");
    if (i !== -1) achadas.splice(i, 1);
  }
  return achadas;
}

/**
 * Monta o bloco de contexto com os itens disponíveis das categorias
 * mencionadas na mensagem. Retorna null se nada foi mencionado ou se o
 * catálogo não tem nada nas categorias.
 */
export async function extrasCatalogoPorCategoria(opts: {
  organizationId: string;
  texto: string | null;
}): Promise<string | null> {
  const cats = categoriasMencionadas(opts.texto);
  if (cats.length === 0) return null;

  const admin = createAdminClient();
  const blocos: string[] = [];
  for (const cat of cats) {
    const lex = LEXICO.find((l) => l.categoria === cat);
    const { data, count } = await admin
      .from("produtos")
      .select("descricao", { count: "exact" })
      .eq("organization_id", opts.organizationId)
      .eq("ativo", true)
      .eq("disponivel", true)
      .eq("categoria", cat)
      .order("descricao")
      .limit(60);
    if (!data || data.length === 0) continue;
    const sufixo =
      (count ?? data.length) > data.length
        ? ` (e mais ${(count ?? 0) - data.length})`
        : "";
    blocos.push(
      `${lex?.label ?? cat}: ${data.map((d) => d.descricao).join("; ")}${sufixo}`,
    );
  }
  if (blocos.length === 0) return null;

  return `[CATÁLOGO REAL — itens disponíveis nas categorias que o cliente mencionou]
${blocos.join("\n")}

Como usar: se o cliente perguntou o que temos, cite as opções de forma natural e resumida (marcas/variações principais, até ~10 — não despeje a lista inteira; se for muita coisa, cite as mais conhecidas e pergunte o que ele curte). Se ele pediu um item genérico (ex: "cerveja", "coca"), use a lista pra perguntar qual variação ele quer. NUNCA cite item que não está na lista, NUNCA invente tamanho/variação, e continue SEM falar de preço.`;
}
