/**
 * Matching item do pedido ↔ catálogo de produtos (tabela `produtos`).
 *
 * Determinístico (sem LLM): normaliza e tokeniza o texto extraído da conversa
 * e procura o produto do catálogo cujos tokens cubram TODOS os tokens do item.
 * Regra de ouro: só casa quando é INEQUÍVOCO — empate/ambiguidade retorna null
 * e o item segue sem código (a equipe resolve). Errar um código é pior que
 * não sugerir nenhum.
 *
 * Cache do catálogo em memória por org (TTL 5min) — 1 réplica no swarm,
 * mesmo padrão do guard de volume em guardrails.ts.
 */

import { createAdminClient } from "@/lib/supabase/admin";

export type ProdutoCatalogo = { codigo_ref: string; descricao: string };

type Cache = { itens: (ProdutoCatalogo & { tokens: string[] })[]; em: number };
const cachePorOrg = new Map<string, Cache>();
const TTL_MS = 5 * 60_000;

/** Palavras de embalagem/quantidade que não identificam o produto.
 *  "com"/"sem" NÃO são stopwords: viram c/s (distinguem C/Gas de S/Gas). */
const STOPWORDS = new Set([
  "de", "da", "do", "das", "dos", "e", "um", "uma",
  "caixa", "caixas", "fardo", "fardos", "pack", "packs", "engradado",
  "unidade", "unidades", "un", "und", "saco", "sacos", "pacote", "pacotes",
]);

/** Normaliza: minúsculas, sem acento, unidades unificadas ("2 litros"→"2l"). */
export function normalizarTexto(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/(\d)\.(\d)/g, "$1,$2") // decimal com ponto ("1.5L" do catálogo) → vírgula pt-BR
    .replace(/(\d)[\s-]*(litros?|lts?|l)\b/g, "$1l")
    .replace(/(\d)[\s-]*(mililitros?|ml)\b/g, "$1ml")
    .replace(/\blitros?\b/g, "l")
    .replace(/\bcom\b/g, " c ") // "com gás" → "c gás" (padrão C/Gas do catálogo)
    .replace(/\bsem\b/g, " s ")
    .replace(/[^a-z0-9,]+/g, " ")
    .trim();
}

function tokenizar(s: string): string[] {
  return normalizarTexto(s)
    .split(/\s+/)
    .filter((t) => t && !STOPWORDS.has(t))
    .map((t) => (t.length > 3 && t.endsWith("s") ? t.slice(0, -1) : t)); // plural naive
}

/** Volume: 600ml, 2l, 1,5l, 2,25l... (vírgula = decimal pt-BR) */
const RE_VOLUME = /^\d+(?:,\d+)?(ml|l)$/;

/**
 * Um token do item "cobre" um token do catálogo se:
 *  - for igual; ou
 *  - for número puro prefixando um volume ("600" → "600ml"); ou
 *  - for prefixo alfabético LONGO (≥5) — evita "lata"→"latão",
 *    "agua"→"aguardente", "cola"→"colarinho" ("retor"→"retornavel" continua ok).
 */
function tokenCasa(itemTok: string, catTok: string): boolean {
  if (itemTok === catTok) return true;
  // número (inclusive decimal "1,5") prefixando volume: "600"→"600ml", "1,5"→"1,5l"
  if (
    /^\d+(?:,\d+)?$/.test(itemTok) &&
    RE_VOLUME.test(catTok) &&
    catTok.startsWith(itemTok)
  )
    return true;
  if (itemTok.length >= 5 && catTok.startsWith(itemTok)) return true;
  return false;
}

async function carregarCatalogo(
  organizationId: string,
): Promise<(ProdutoCatalogo & { tokens: string[] })[]> {
  const hit = cachePorOrg.get(organizationId);
  if (hit && Date.now() - hit.em < TTL_MS) return hit.itens;

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("produtos")
    .select("codigo_ref, descricao")
    .eq("organization_id", organizationId)
    .eq("ativo", true)
    .limit(2000);

  // Erro transitório do banco: NÃO cacheia vazio (mataria o matching por 5min);
  // serve o cache velho se houver, senão vazio só desta vez.
  if (error) {
    console.warn("[catalogo] falha ao carregar:", error.message);
    return hit?.itens ?? [];
  }

  const itens = (data ?? []).map((p) => ({
    codigo_ref: p.codigo_ref as string,
    descricao: p.descricao as string,
    tokens: tokenizar(p.descricao),
  }));
  cachePorOrg.set(organizationId, { itens, em: Date.now() });
  return itens;
}

/** Invalida o cache da org — chamar nos CRUDs de produto (mesmo processo Node). */
export function invalidarCatalogo(organizationId: string): void {
  cachePorOrg.delete(organizationId);
}

/**
 * Tenta casar o texto de um item com UM produto do catálogo.
 * Retorna null quando: nenhum candidato, ou mais de um candidato igualmente
 * bom (ambíguo — ex: "skol" sozinho casa lata E litrão E 600ml).
 */
export async function matchCatalogo(
  organizationId: string,
  produtoTexto: string,
): Promise<ProdutoCatalogo | null> {
  const itemToks = tokenizar(produtoTexto);
  if (itemToks.length === 0) return null;

  const catalogo = await carregarCatalogo(organizationId);
  if (catalogo.length === 0) return null;

  // Atalho: o cliente falou o próprio código ("me ve 2 600C")
  const codigoDireto = catalogo.find((c) =>
    itemToks.some((t) => t === c.codigo_ref.toLowerCase()),
  );
  if (codigoDireto && itemToks.length <= 2) return codigoDireto;

  const direto = escolherCandidato(catalogo, itemToks);
  if (direto) return direto;

  // Retry SEM tokens de volume (350ml, 2l, 1,5l...): o LLM às vezes anota o
  // volume que o catálogo omite ("Coca lata 350ml" vs "Lata Coca Cola"). Guarda:
  // o candidato NÃO pode ter volume próprio diferente (senão casaria lata↔litrão).
  const semVolume = itemToks.filter((t) => !RE_VOLUME.test(t));
  if (semVolume.length > 0 && semVolume.length < itemToks.length) {
    const cand = escolherCandidato(catalogo, semVolume, {
      recusarSeTemVolumeDiferente: itemToks,
    });
    if (cand) return cand;
  }
  return null;
}

function escolherCandidato(
  catalogo: (ProdutoCatalogo & { tokens: string[] })[],
  itemToks: string[],
  opts?: { recusarSeTemVolumeDiferente?: string[] },
): ProdutoCatalogo | null {
  // Candidatos: TODOS os tokens do item precisam casar com algum token do produto
  let candidatos = catalogo.filter((c) =>
    itemToks.every((it) => c.tokens.some((ct) => tokenCasa(it, ct))),
  );
  if (opts?.recusarSeTemVolumeDiferente) {
    const volsItem = new Set(
      opts.recusarSeTemVolumeDiferente.filter((t) => RE_VOLUME.test(t)),
    );
    candidatos = candidatos.filter(
      (c) => !c.tokens.some((ct) => RE_VOLUME.test(ct) && !volsItem.has(ct)),
    );
  }
  if (candidatos.length === 0) return null;
  if (candidatos.length === 1) return candidatos[0];

  // Vários candidatos: prefere o MAIS específico (menos tokens sobrando).
  // Se houver empate no topo → ambíguo → null.
  const ordenados = candidatos
    .map((c) => ({ c, sobra: c.tokens.length - itemToks.length }))
    .sort((a, b) => a.sobra - b.sobra);
  const melhor = ordenados[0];
  const segundo = ordenados[1];
  if (segundo && segundo.sobra === melhor.sobra) return null; // empate = ambíguo
  // Só aceita se o melhor cobre "quase tudo" do produto (sobra pequena)
  if (melhor.sobra > 2) return null;
  return melhor.c;
}
