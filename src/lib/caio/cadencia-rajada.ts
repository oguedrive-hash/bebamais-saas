/**
 * CADÊNCIA EM RAJADA — espaçamento de disparo em lote que imita humano.
 *
 * Antipadrão (o que tínhamos): mesmo gap fixo N vezes seguidas — assinatura de
 * automação. Aqui: rajadas curtas (poucas msgs com gap de segundos) separadas
 * por pausas longas e aleatórias de minutos. Pausa >> gap é o que cria o formato.
 */

export type ParametrosCadencia = {
  rajadaMin: number; rajadaMax: number;      // nº de msgs seguidas
  gapMinSeg: number; gapMaxSeg: number;      // segundos DENTRO da rajada
  pausaMinMin: number; pausaMaxMin: number;  // minutos ENTRE rajadas
};

/** Pausa muito maior que o gap é o que cria o "formato humano". */
export const CADENCIA_DEFAULT: ParametrosCadencia = {
  rajadaMin: 4,  rajadaMax: 8,
  gapMinSeg: 15, gapMaxSeg: 75,
  pausaMinMin: 12, pausaMaxMin: 28,
};

function inteiroEntre(min: number, max: number, rnd: () => number): number {
  if (max <= min) return min;
  return min + Math.floor(rnd() * (max - min + 1));
}

/**
 * Offsets em SEGUNDOS a partir de agora, um por mensagem, na ordem da fila.
 * O primeiro é pequeno mas não zero: disparo instantâneo ao clicar é assinatura
 * de automação, e zero atrapalha a reconciliação de envio.
 */
export function calcularOffsetsRajada(
  quantidade: number,
  params: ParametrosCadencia = CADENCIA_DEFAULT,
  rnd: () => number = Math.random,
  primeiroOffsetSeg = 5,
): number[] {
  if (quantidade <= 0) return [];
  const offsets: number[] = [];
  let t = primeiroOffsetSeg;
  let restanteNaRajada = inteiroEntre(params.rajadaMin, params.rajadaMax, rnd);
  for (let i = 0; i < quantidade; i++) {
    offsets.push(Math.round(t));
    restanteNaRajada--;
    if (restanteNaRajada <= 0) {
      t += inteiroEntre(params.pausaMinMin, params.pausaMaxMin, rnd) * 60;  // pausa longa
      restanteNaRajada = inteiroEntre(params.rajadaMin, params.rajadaMax, rnd);
    } else {
      t += inteiroEntre(params.gapMinSeg, params.gapMaxSeg, rnd);           // gap curto
    }
  }
  return offsets;
}

export function duracaoEstimadaMin(offsets: number[]): number {
  if (offsets.length === 0) return 0;
  return Math.ceil((offsets[offsets.length - 1] ?? 0) / 60);
}
