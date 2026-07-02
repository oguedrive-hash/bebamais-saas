/**
 * Guardrails anti-ban (operação no Baileys/Evolution não-oficial).
 * Baseado nos gatilhos de ban de 2026: reply-ratio, contador de mensagens sem
 * resposta em 48h, taxa de bloqueio, e volume/velocidade. O núcleo REATIVO
 * (responder quem manda msg) é de baixo risco; estes limites protegem a parte
 * PROATIVA (follow-up, reativação, prospecção), que é onde mora o risco.
 */

/** Detecta pedido explícito de opt-out ("não quero mais", "para de me mandar"...).
 *  Específico de propósito — evita falso-positivo que descadastra um lead bom. */
const OPT_OUT_RX =
  /(n[ãa]o quero(?: receber)? mais(?: (?:mensagens?|nada|isso))?|par[ae] de (?:me )?(?:mandar|enviar|perturbar|incomodar)|me tir[ae] (?:da lista|daqui|dessa lista|disso)|me remov[ae](?: da lista)?|descadastr|sair da lista|n[ãa]o me (?:mande|envie|perturbe|incomode) mais|tir[ae] meu (?:n[úu]mero|contato)|chega de (?:mensagem|mensagens|spam)|unsubscribe|me bloqueia|para com (?:isso|as mensagens))/i;

export function ehOptOut(texto: string | null | undefined): boolean {
  return !!texto && OPT_OUT_RX.test(texto);
}

/** Teto de follow-ups SEM RESPOSTA por lead (protege o contador de 48h do WhatsApp).
 *  numero_followup zera quando o lead responde, então é a contagem consecutiva. */
export const MAX_FOLLOWUP_SEM_RESPOSTA = 4;

/** Teto de contatos NOVOS por dia por número na prospecção (cold = maior risco). */
export const MAX_PROSPECCAO_DIA = 18;

/** Teto de envios PROATIVOS por hora por número (anti-velocidade). Reativo NÃO conta. */
const MAX_PROATIVO_HORA = 25;

/** Janela de horário comercial pra envio PROATIVO (follow-up/reativação):
 *  8h–20h America/Sao_Paulo. Reativo (responder quem chamou) NÃO passa por aqui. */
export function dentroDaJanelaProativa(): boolean {
  const hora = Number(
    new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      hour12: false,
      timeZone: "America/Sao_Paulo",
    }).format(new Date()),
  );
  return hora >= 8 && hora < 20;
}

// Janela deslizante em memória (o painel roda 1 réplica no swarm; reset no deploy
// é aceitável pra um guard soft). NÃO usar pra reativo — só proativo.
const janelaHora = new Map<string, number[]>();
export function podeEnviarProativo(instance: string | null | undefined, max = MAX_PROATIVO_HORA): boolean {
  if (!instance) return true;
  const agora = Date.now();
  const arr = (janelaHora.get(instance) ?? []).filter((t) => agora - t < 3_600_000);
  if (arr.length >= max) {
    console.warn(`[guardrail] volume: ${instance} bateu ${max}/h — adiando proativo`);
    return false;
  }
  arr.push(agora);
  janelaHora.set(instance, arr);
  return true;
}

const diaProsp = new Map<string, { dia: string; n: number }>();
export function podeProspectarHoje(instance: string | null | undefined, max = MAX_PROSPECCAO_DIA): boolean {
  if (!instance) return true;
  const dia = new Date().toISOString().slice(0, 10);
  const e = diaProsp.get(instance);
  if (!e || e.dia !== dia) {
    diaProsp.set(instance, { dia, n: 1 });
    return true;
  }
  if (e.n >= max) {
    console.warn(`[guardrail] prospecção: ${instance} bateu ${max} contatos novos hoje — pausando`);
    return false;
  }
  e.n++;
  return true;
}
