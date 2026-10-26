/**
 * ASSINATURA no WhatsApp (pedido da Beba Mais, igual à iBrasileira): a
 * mensagem que uma atendente manda pelo painel sai com o nome dela na primeira
 * linha, em negrito — "*ANA*:" — e o texto embaixo. O cliente (ou o grupo) sabe
 * quem está falando. No painel a mensagem fica SEM a assinatura: o balão já
 * mostra quem mandou.
 *
 * O assistente não assina: ele já se apresenta como da loja na conversa.
 */

/** Nomes que não dizem quem é a pessoa: não viram assinatura. */
const GENERICOS = new Set(["administrador", "administradora", "admin", "atendente", "loja", "equipe", "usuario"]);

function semAcento(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** Primeiro nome em maiúsculas ("Ana Paula Souza" → "ANA"), ou null se não serve para assinar. */
export function nomeDaAssinatura(nome: string | null | undefined): string | null {
  const primeiro = (nome ?? "").trim().split(/\s+/)[0]?.replace(/[*_~]/g, "") ?? "";
  if (!primeiro || GENERICOS.has(semAcento(primeiro))) return null;
  return primeiro.toLocaleUpperCase("pt-BR");
}

/** Texto como sai no WhatsApp: "*ANA*:\nTexto". Sem nome que sirva, sai o texto puro. */
export function assinar(nome: string | null | undefined, texto: string): string {
  const n = nomeDaAssinatura(nome);
  return n ? `*${n}*:\n${texto}` : texto;
}

/** Legenda de foto/arquivo: assinada; sem legenda, só o nome ("*ANA*"). */
export function assinarLegenda(nome: string | null | undefined, legenda: string | undefined): string | undefined {
  const n = nomeDaAssinatura(nome);
  if (!n) return legenda;
  return legenda?.trim() ? `*${n}*:\n${legenda.trim()}` : `*${n}*`;
}
