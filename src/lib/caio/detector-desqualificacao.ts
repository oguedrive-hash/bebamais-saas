/**
 * Detecta se a resposta gerada pela IA eh uma desqualificacao do lead
 * (BANT nao passou — autonomo sozinho, sem autoridade, volume baixo, etc).
 *
 * Detecta por pattern matching nos fingerprints do prompt — o prompt instrui
 * a IA a usar frases especificas pra desqualificar, entao a deteccao eh
 * deterministica e barata (sem chamada extra a LLM).
 */

export type MotivoDesqualificacao =
  | "nao_encaixa"
  | "trazer_decisor";

const PADROES: { motivo: MotivoDesqualificacao; re: RegExp }[] = [
  // Frases do PASSO 8 do prompt: desqualificacao por porte/volume
  {
    motivo: "nao_encaixa",
    re: /n[aã]o seria o melhor encaixe/i,
  },
  {
    motivo: "nao_encaixa",
    re: /quando.{0,40}operac[aã]o crescer/i,
  },
  {
    motivo: "nao_encaixa",
    re: /melhor retorno.{0,40}(?:operac[oõ]es|empresas).{0,40}(?:equipe|estruturad)/i,
  },
  // Pedido pra trazer decisor — nao eh desqualificacao final mas vale flag
  {
    motivo: "trazer_decisor",
    re: /(?:traz|tras).{0,15}(?:seu chefe|junto na conversa|junto pra conversa|decis[oõ]r)/i,
  },
];

export function detectarDesqualificacao(
  resposta: string,
): { motivo: MotivoDesqualificacao } | null {
  if (!resposta?.trim()) return null;
  for (const p of PADROES) {
    if (p.re.test(resposta)) return { motivo: p.motivo };
  }
  return null;
}
