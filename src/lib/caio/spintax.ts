/**
 * SPINTAX — variação de mensagem para disparo em lote.
 *
 * SINTAXE
 *   {a|b|c}    escolhe uma das opções
 *   {a|b|}     opção vazia é válida (some às vezes)
 *   aninhado   {Oi{ tudo bem|}|Olá} funciona
 *   {nome}     NÃO é spintax — variável de lead, fica INTACTA
 *
 * A distinção é o `|`: bloco sem pipe é variável. É o que permite spintax e
 * {nome} conviverem na mesma string.
 */

export function resolverSpintax(
  texto: string,
  rnd: () => number = Math.random,
): string {
  if (!texto) return texto;
  let out = texto;
  // Bloco mais interno = sem { } dentro. Processa de dentro pra fora, o que faz
  // aninhamento funcionar sem parser recursivo.
  const BLOCO_INTERNO = /\{([^{}]*\|[^{}]*)\}/;
  for (let i = 0; i < 200; i++) {          // teto: protege contra string patológica
    const m = out.match(BLOCO_INTERNO);
    if (!m) break;
    const opcoes = m[1].split("|");
    const escolha = opcoes[Math.floor(rnd() * opcoes.length)] ?? "";
    out = out.slice(0, m.index!) + escolha + out.slice(m.index! + m[0].length);
  }
  out = out
    .replace(/[ \t]{2,}/g, " ")      // opção vazia deixa espaço duplo
    .replace(/ +([,.!?])/g, "$1")
    .trim();
  // Maiúscula no início e depois de . ! ? — sem isso, opção vazia no começo da
  // frase produz "beleza? você tem..." (minúscula), que lê como descuido.
  return out.replace(
    /(^|[.!?]\s+)([a-záàâãéêíóôõúüç])/g,
    (_m, pre: string, letra: string) => pre + letra.toUpperCase(),
  );
}

/** Quantas variações a string gera. Serve pra AVISAR quando a variação é
 *  insuficiente pro tamanho do lote (500 msgs com 4 variações não protege). */
export function contarVariacoes(texto: string): number {
  if (!texto) return 1;
  let total = 1;
  let out = texto;
  const BLOCO_INTERNO = /\{([^{}]*\|[^{}]*)\}/;
  for (let i = 0; i < 200; i++) {
    const m = out.match(BLOCO_INTERNO);
    if (!m) break;
    total *= m[1].split("|").length;
    out = out.slice(0, m.index!) + (m[1].split("|")[0] ?? "") + out.slice(m.index! + m[0].length);
    if (total > 1_000_000) return total;
  }
  return total;
}

/** True se o texto usa spintax. */
export function temSpintax(texto: string): boolean {
  return /\{[^{}]*\|[^{}]*\}/.test(texto ?? "");
}
