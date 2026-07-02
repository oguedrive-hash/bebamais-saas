/**
 * Config de slots fixos da agenda de uma org.
 *
 * - dias_semana: ISO (1=segunda ... 7=domingo). Default: seg a sex.
 * - slots: blocos de horário FIXOS que a operação trabalha (ex: 8h-10h30).
 *   Cada slot é independente — a IA (quando agenda automaticamente) propõe
 *   o slot inteiro ao lead. Operação manual também pode usar como sugestão.
 *
 * Horário sempre em HH:mm 24h, fuso da org (atualmente só America/Sao_Paulo).
 */

export type SlotHorario = {
  inicio: string; // "HH:mm"
  fim: string; // "HH:mm"
};

/**
 * Modo de agendamento:
 *  - "slot": cada bloco de `slots` vira um agendamento fixo (ex: 8h-10h30
 *    é uma reunião inteira). A IA só agenda dentro desses blocos.
 *  - "duracao": os blocos de `slots` viram JANELAS de atendimento (ex: 8h-12h
 *    é a janela da manhã). A IA aloca dentro com `duracao_padrao`. Gap entre
 *    janelas (12h-13h) é pausa automática.
 *
 * Org escolhe um dos dois — nunca os dois juntos.
 */
export type ModoAgenda = "slot" | "duracao";

export type AgendaConfig = {
  modo: ModoAgenda;
  dias_semana: number[]; // 1=seg, 7=dom
  slots: SlotHorario[];
  duracoes: number[]; // minutos — botões de duração no form "Novo agendamento"
  duracao_padrao: number; // qual duração a IA usa por default no modo "duracao"
  antecedencia_minima_horas: number; // não agendar nas próximas N horas
  horizonte_dias: number; // só agendar nos próximos N dias
  qtd_opcoes_propor: number; // quantos slots a IA oferece por vez
};

export const AGENDA_CONFIG_DEFAULT: AgendaConfig = {
  modo: "slot",
  dias_semana: [1, 2, 3, 4, 5],
  slots: [
    { inicio: "08:00", fim: "10:30" },
    { inicio: "10:30", fim: "12:00" },
    { inicio: "13:00", fim: "15:30" },
    { inicio: "15:30", fim: "18:00" },
  ],
  duracoes: [15, 30, 45, 60, 90, 120],
  duracao_padrao: 60,
  antecedencia_minima_horas: 2,
  horizonte_dias: 14,
  qtd_opcoes_propor: 3,
};

const RE_HORARIO = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

export function getAgendaConfig(raw: unknown): AgendaConfig {
  if (!raw || typeof raw !== "object") return AGENDA_CONFIG_DEFAULT;
  const obj = raw as Record<string, unknown>;

  const diasRaw = Array.isArray(obj.dias_semana) ? obj.dias_semana : [];
  const dias_semana = diasRaw
    .filter((d): d is number => typeof d === "number" && d >= 1 && d <= 7)
    .sort();

  const slotsRaw = Array.isArray(obj.slots) ? obj.slots : [];
  const slots: SlotHorario[] = [];
  for (const s of slotsRaw) {
    if (!s || typeof s !== "object") continue;
    const so = s as Record<string, unknown>;
    if (
      typeof so.inicio !== "string" ||
      typeof so.fim !== "string" ||
      !RE_HORARIO.test(so.inicio) ||
      !RE_HORARIO.test(so.fim) ||
      so.inicio >= so.fim
    ) {
      continue;
    }
    slots.push({ inicio: so.inicio, fim: so.fim });
  }

  const duracoesRaw = Array.isArray(obj.duracoes) ? obj.duracoes : [];
  const duracoes = duracoesRaw
    .filter(
      (n): n is number =>
        typeof n === "number" && Number.isInteger(n) && n >= 5 && n <= 480,
    )
    .sort((a, b) => a - b);

  const modo: ModoAgenda = obj.modo === "duracao" ? "duracao" : "slot";

  const duracoesFinal = duracoes.length > 0 ? duracoes : AGENDA_CONFIG_DEFAULT.duracoes;
  const duracaoPadraoRaw = obj.duracao_padrao;
  const duracaoPadrao =
    typeof duracaoPadraoRaw === "number" &&
    Number.isInteger(duracaoPadraoRaw) &&
    duracoesFinal.includes(duracaoPadraoRaw)
      ? duracaoPadraoRaw
      : (duracoesFinal[0] ?? AGENDA_CONFIG_DEFAULT.duracao_padrao);

  const antecedenciaRaw = obj.antecedencia_minima_horas;
  const antecedencia =
    typeof antecedenciaRaw === "number" &&
    antecedenciaRaw >= 0 &&
    antecedenciaRaw <= 168
      ? antecedenciaRaw
      : AGENDA_CONFIG_DEFAULT.antecedencia_minima_horas;

  const horizonteRaw = obj.horizonte_dias;
  const horizonte =
    typeof horizonteRaw === "number" &&
    Number.isInteger(horizonteRaw) &&
    horizonteRaw >= 1 &&
    horizonteRaw <= 365
      ? horizonteRaw
      : AGENDA_CONFIG_DEFAULT.horizonte_dias;

  const qtdOpcoesRaw = obj.qtd_opcoes_propor;
  const qtdOpcoes =
    typeof qtdOpcoesRaw === "number" &&
    Number.isInteger(qtdOpcoesRaw) &&
    qtdOpcoesRaw >= 1 &&
    qtdOpcoesRaw <= 10
      ? qtdOpcoesRaw
      : AGENDA_CONFIG_DEFAULT.qtd_opcoes_propor;

  return {
    modo,
    dias_semana: dias_semana.length > 0 ? dias_semana : AGENDA_CONFIG_DEFAULT.dias_semana,
    slots: slots.length > 0 ? slots : AGENDA_CONFIG_DEFAULT.slots,
    duracoes: duracoesFinal,
    duracao_padrao: duracaoPadrao,
    antecedencia_minima_horas: antecedencia,
    horizonte_dias: horizonte,
    qtd_opcoes_propor: qtdOpcoes,
  };
}
