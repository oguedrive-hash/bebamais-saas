/**
 * Resposta determinística pra perguntas do lead sobre dias/horários atendidos.
 *
 * Lê DIRETO da `agenda_config` da org (sem LLM, sem contexto, sem histórico).
 * Objetivo: garantir que o Caio nunca diga "não atendemos terça" quando a
 * config diz que sim. LLM era estocástico demais — esse caminho é fixo.
 *
 * Detecta o caso via regex simples no texto do lead. Se bate, gera resposta
 * template e o caller envia direto pelo Chatwoot, pulando `gerarRespostaCaio`.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import {
  AGENDA_CONFIG_DEFAULT,
  getAgendaConfig,
} from "@/lib/caio/agenda-config";

const FUSO = "America/Sao_Paulo";
const UTC_OFFSET_MIN = -180; // -03:00

function montarHorarioEmDataSP(
  ano: number,
  mes: number,
  dia: number,
  hhmm: string,
): Date {
  const [h, m] = hhmm.split(":").map(Number);
  const utc = new Date(Date.UTC(ano, mes - 1, dia, h, m, 0));
  utc.setUTCMinutes(utc.getUTCMinutes() - UTC_OFFSET_MIN);
  return utc;
}

function diaSemanaSP(d: Date): number {
  const wd = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    timeZone: FUSO,
  }).format(d);
  const map: Record<string, number> = {
    Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7,
  };
  return map[wd] ?? 1;
}

/**
 * Encontra a próxima ocorrência de um dia da semana específico (1=seg ... 7=dom)
 * no fuso de SP. Retorna metadata pra construir slots.
 */
function encontrarProximaOcorrencia(
  agora: Date,
  diaSemanaAlvo: number,
): {
  ano: number;
  mes: number;
  dia: number;
  inicioDia: Date;
  fimDia: Date;
  label: string;
} | null {
  // Busca dia atual em SP
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: FUSO,
  }).formatToParts(agora);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  let ano = get("year");
  let mes = get("month");
  let dia = get("day");

  for (let i = 0; i < 14; i++) {
    const ref = montarHorarioEmDataSP(ano, mes, dia, "12:00");
    if (diaSemanaSP(ref) === diaSemanaAlvo) {
      const inicioDia = montarHorarioEmDataSP(ano, mes, dia, "00:00");
      const fimDia = new Date(inicioDia.getTime() + 86400 * 1000);
      const label = inicioDia.toLocaleString("pt-BR", {
        timeZone: FUSO,
        weekday: "long",
        day: "2-digit",
        month: "2-digit",
      });
      return { ano, mes, dia, inicioDia, fimDia, label };
    }
    const proxima = new Date(Date.UTC(ano, mes - 1, dia + 1));
    ano = proxima.getUTCFullYear();
    mes = proxima.getUTCMonth() + 1;
    dia = proxima.getUTCDate();
  }
  return null;
}

const NOMES_DIAS_LISTA = [
  "",
  "segunda",
  "terça",
  "quarta",
  "quinta",
  "sexta",
  "sábado",
  "domingo",
];

// Nome de dia (com ou sem acento, com ou sem "feira")
const DIA_REGEX =
  "(?:s[aá]bado|domingo|segunda|ter[cç]a|quarta|quinta|sexta|fim\\s+de\\s+semana|esse[s]?\\s+dia[s]?)";

// Inclui referências relativas: "hoje", "amanhã", "depois de amanhã"
const DIA_OU_REL_REGEX = `(?:${DIA_REGEX.slice(3, -1)}|hoje|amanh[aã]|depois\\s+de\\s+amanh[aã])`;

// Sinais textuais de pergunta sobre disponibilidade. Casa o lower-case do
// conteúdo do lead com algum desses padrões. Cobrindo várias preposições
// (de/em/no/na/para/pra/aos), com ou sem "não", e atalhos curtos.
const PADROES_DISPONIBILIDADE = [
  // "atendem sábado?", "atendem amanhã?", "atendem em qual dia?"
  new RegExp(
    `atend[eo]m?\\s+(?:de\\s+|aos?\\s+|no\\s+|na\\s+|em\\s+|que\\s+|quais\\s+|os?\\s+)?${DIA_OU_REL_REGEX}`,
    "i",
  ),
  /(?:atend[eo]m|trabalham)\s+(?:em\s+)?(quais|que)\s+(dia|hora)/i,
  // "tem terça?", "tem amanhã?", "não tem terça?", "tem horário pra amanhã?"
  new RegExp(
    `(?:n[aã]o\\s+)?(?:tem|tendem|t[eê]m)(?:\\s+hor[aá]rio[s]?)?\\s+(?:de\\s+|em\\s+|no\\s+|na\\s+|para\\s+|pra\\s+|aos?\\s+)?${DIA_OU_REL_REGEX}`,
    "i",
  ),
  // "amanhã tem?", "amanhã tem horário?", "hoje tem disponibilidade?"
  new RegExp(
    `${DIA_OU_REL_REGEX}\\s+(?:tem|t[eê]m)(?:\\s+hor[aá]rio[s]?|\\s+disponibilidade)?`,
    "i",
  ),
  /quais\s+(?:os\s+|seus\s+)?(?:dia|hor[aá]rio|disponibilidade)/i,
  /que\s+dia[s]?\s+(?:voc[eê]s?\s+|a\s+facilita\s+)?(?:atend|trabalh|funcion)/i,
  /em\s+quais?\s+dias/i,
  /qual\s+(?:o\s+)?hor[aá]rio\s+(?:de\s+)?(?:atend|funcion|trabalh)/i,
  /quais\s+(?:s[aã]o\s+)?(?:os\s+)?hor[aá]rios?/i,
  /(?:tem|t[eê]m)\s+agenda/i,
  /disponibilidade/i,
  // Resposta curta só com nome de dia ou referência relativa (sem horário):
  // "terça", "segunda", "amanhã", "hoje", "pode ser quinta", "terça-feira".
  // Indica que o lead está escolhendo dia em resposta à pergunta anterior.
  new RegExp(
    `^[^0-9:]{0,30}${DIA_OU_REL_REGEX}(?:-feira)?[^0-9:]{0,30}$`,
    "i",
  ),
  // "que horário voces têm", "qual horario disponível", "que horário tem
  // pra segunda", "qual horario livre pra amanhã". Cobre perguntas sobre
  // horários SEM ser específicamente sobre horário-de-funcionamento.
  /(?:que|qual|quais)\s+hor[aá]rio[s]?(?:\s+\w+){0,5}\s+(?:tem|t[eê]m|dispon[ií]vel|livre|sobr[ao]m?|ficar?am?)/i,
  // Lead aponta "{dia} de tarde" / "amanhã pela manhã" — pedido implícito
  // pra ver horários do turno. Sem isso, o classificador-aceite pega "tarde"
  // como 14h default e tenta agendar num horário que pode nem existir.
  new RegExp(
    `${DIA_OU_REL_REGEX}(?:-feira)?\\s+(?:de\\s+|[aà]\\s+|na\\s+|pela\\s+)?(?:manh[aã]|tarde|noite)`,
    "i",
  ),
];

function ehPerguntaSobreDisponibilidade(msg: string | null): boolean {
  if (!msg?.trim()) return false;
  return PADROES_DISPONIBILIDADE.some((p) => p.test(msg));
}

function descreverDiasNatural(dias: number[]): string {
  if (dias.length === 7) return "todos os dias da semana";
  if (
    dias.length === 5 &&
    [1, 2, 3, 4, 5].every((d) => dias.includes(d))
  ) {
    return "de segunda a sexta";
  }
  const nomes = dias.map((d) => NOMES_DIAS_LISTA[d]).filter(Boolean);
  if (nomes.length === 1) return nomes[0];
  if (nomes.length === 2) return nomes.join(" e ");
  return nomes.slice(0, -1).join(", ") + " e " + nomes[nomes.length - 1];
}

/**
 * Extrai do texto qual dia da semana o lead mencionou (1=seg ... 7=dom).
 * Cobre nomes de dias da semana E referências relativas ("hoje", "amanhã",
 * "depois de amanhã"). Retorna null se nenhum foi citado.
 *
 * Pra referências relativas, calcula no fuso de SP qual dia da semana cai.
 */
function diaMencionado(msg: string): number | null {
  // Primeiro tenta nomes de dias literais
  const mapNomes: { padrao: RegExp; dia: number }[] = [
    { padrao: /\bsegunda\b/i, dia: 1 },
    { padrao: /\bter[cç]a\b/i, dia: 2 },
    { padrao: /\bquarta\b/i, dia: 3 },
    { padrao: /\bquinta\b/i, dia: 4 },
    { padrao: /\bsexta\b/i, dia: 5 },
    { padrao: /\bs[aá]bado\b/i, dia: 6 },
    { padrao: /\bdomingo\b/i, dia: 7 },
  ];
  for (const { padrao, dia } of mapNomes) {
    if (padrao.test(msg)) return dia;
  }

  // Referências relativas em PT-BR.
  // NOTA: JS `\b` (word boundary) é ASCII-only, então `\bamanh[aã]\b` NÃO
  // bate "amanhã" com til (`ã` quebra a fronteira mecânica). Usamos
  // `(?:^|\W)` + lookahead `(?=\W|$)` que aceita qualquer não-word char.
  const agora = new Date();
  const hoje = diaSemanaSP(agora);
  if (/depois\s+de\s+amanh[aã]/i.test(msg)) {
    const d = new Date(agora.getTime() + 2 * 86400 * 1000);
    return diaSemanaSP(d);
  }
  if (/(?:^|\W)amanh[aã](?=\W|$)/i.test(msg)) {
    const d = new Date(agora.getTime() + 1 * 86400 * 1000);
    return diaSemanaSP(d);
  }
  if (/(?:^|\W)hoje(?=\W|$)/i.test(msg)) {
    return hoje;
  }
  return null;
}

export type TurnoDia = "manha" | "tarde" | "noite";

/**
 * Detecta menção a turno na mensagem ("de manhã", "à tarde", "à noite").
 * Manhã = início < 12h. Tarde = 12h–18h. Noite = ≥ 18h.
 * Retorna null se nenhum turno foi citado.
 */
export function turnoMencionado(msg: string | null): TurnoDia | null {
  if (!msg) return null;
  // "manhã", "manha", "de manhã", "pela manhã"
  if (/(?:^|\W)manh[aã](?=\W|$)/i.test(msg)) return "manha";
  // "tarde", "à tarde", "de tarde"
  if (/(?:^|\W)tarde(?=\W|$)/i.test(msg)) return "tarde";
  // "noite", "à noite", "de noite"
  if (/(?:^|\W)noite(?=\W|$)/i.test(msg)) return "noite";
  return null;
}

function horarioEhDoTurno(hhmm: string, turno: TurnoDia): boolean {
  const [h] = hhmm.split(":").map(Number);
  if (turno === "manha") return h < 12;
  if (turno === "tarde") return h >= 12 && h < 18;
  return h >= 18; // noite
}

/**
 * Gera só a linha de horários disponíveis pra um dia da semana específico,
 * sem saudação nem prefixo de "atendemos sim". Reutilizada em outros lugares
 * (ex: quando o lead pediu horário fora dos slots mas o dia é atendido).
 *
 * Se `turno` for fornecido, filtra horários pelo turno (manhã < 12h,
 * tarde 12h-18h, noite ≥ 18h).
 *
 * Retorna null se não houver horário livre.
 */
export async function gerarLinhaHorariosDoDia(opts: {
  organizationId: string;
  diaSemana: number;
  turno?: TurnoDia;
}): Promise<string | null> {
  const admin = createAdminClient();
  const { data: org } = await admin
    .from("organizations")
    .select("agenda_config")
    .eq("id", opts.organizationId)
    .single();
  const agenda = org?.agenda_config
    ? getAgendaConfig(org.agenda_config)
    : AGENDA_CONFIG_DEFAULT;

  const agora = new Date();
  const limiteAntecedencia = new Date(
    agora.getTime() + agenda.antecedencia_minima_horas * 3600 * 1000,
  );

  // Horários livres de UMA ocorrência concreta (dia específico). Lê os slots
  // reais da agenda + agendamentos ocupados — determinístico, sem alucinar.
  const slotsDaOcorrencia = async (oc: {
    ano: number;
    mes: number;
    dia: number;
    inicioDia: Date;
    fimDia: Date;
    label: string;
  }): Promise<string[]> => {
    const { data: ocupados } = await admin
      .from("agendamentos")
      .select("data_inicio, data_fim")
      .eq("organization_id", opts.organizationId)
      .eq("status", "agendado")
      .gte("data_inicio", oc.inicioDia.toISOString())
      .lt("data_inicio", oc.fimDia.toISOString());
    const livres: string[] = [];
    for (const slot of agenda.slots) {
      const slotInicio = montarHorarioEmDataSP(oc.ano, oc.mes, oc.dia, slot.inicio);
      const slotFim = montarHorarioEmDataSP(oc.ano, oc.mes, oc.dia, slot.fim);
      if (slotInicio.getTime() < limiteAntecedencia.getTime()) continue;
      const conflita = (ocupados ?? []).some((o) => {
        const oIni = new Date(o.data_inicio).getTime();
        const oFim = new Date(o.data_fim).getTime();
        return slotInicio.getTime() < oFim && slotFim.getTime() > oIni;
      });
      if (conflita) continue;
      if (opts.turno && !horarioEhDoTurno(slot.inicio, opts.turno)) continue;
      livres.push(slot.inicio);
    }
    return livres;
  };

  // 1ª ocorrência (pode ser HOJE). Se hoje já esgotou (todos os slots caíram
  // dentro da antecedência), rola pra próxima semana daquele dia em vez de só
  // pedir "qual outro dia" — assim o Caio sempre oferece horário concreto.
  let oc = encontrarProximaOcorrencia(agora, opts.diaSemana);
  if (!oc) return null;
  let horariosLivres = await slotsDaOcorrencia(oc);
  if (horariosLivres.length === 0) {
    const seguinte = encontrarProximaOcorrencia(oc.fimDia, opts.diaSemana);
    if (seguinte) {
      const livres2 = await slotsDaOcorrencia(seguinte);
      if (livres2.length > 0) {
        oc = seguinte;
        horariosLivres = livres2;
      }
    }
  }

  if (horariosLivres.length === 0) return null;
  return `Na ${oc.label} tenho disponível às ${horariosLivres.join(", ")}. Qual horário prefere?`;
}

export async function tentarResponderDisponibilidade(opts: {
  organizationId: string;
  conteudoLead: string | null;
  nomeLead: string | null;
}): Promise<string | null> {
  if (!ehPerguntaSobreDisponibilidade(opts.conteudoLead)) return null;

  const admin = createAdminClient();
  const { data: org } = await admin
    .from("organizations")
    .select("agenda_config")
    .eq("id", opts.organizationId)
    .single();
  const agenda = org?.agenda_config
    ? getAgendaConfig(org.agenda_config)
    : AGENDA_CONFIG_DEFAULT;

  const primeiroNome = opts.nomeLead?.split(" ")[0] ?? null;
  const saudacao = primeiroNome ? `${primeiroNome}, ` : "";
  const diaCitado = diaMencionado(opts.conteudoLead ?? "");
  const dias = descreverDiasNatural(agenda.dias_semana);

  // Caso 1: lead mencionou dia NÃO atendido (ex: sábado, domingo)
  // Explica + pergunta qual dia ele prefere dentro dos atendidos
  if (diaCitado !== null && !agenda.dias_semana.includes(diaCitado)) {
    const nomeDia = NOMES_DIAS_LISTA[diaCitado];
    return `${saudacao}${nomeDia} a gente não atende. Atendemos ${dias}. Qual desses dias funciona melhor pra você?`;
  }

  // Caso 2: lead mencionou dia ATENDIDO — lista os horários daquele dia
  // direto da config (sem passar pelo calcularSlotsLivres que diversifica).
  // Se citou turno (manhã/tarde/noite), filtra os horários por aquele turno.
  if (diaCitado !== null && agenda.dias_semana.includes(diaCitado)) {
    const turno = turnoMencionado(opts.conteudoLead ?? null);
    const linha = await gerarLinhaHorariosDoDia({
      organizationId: opts.organizationId,
      diaSemana: diaCitado,
      turno: turno ?? undefined,
    });
    if (!linha) {
      // Se filtrou por turno e não tem nada, tenta sem o filtro
      if (turno) {
        const linhaSemTurno = await gerarLinhaHorariosDoDia({
          organizationId: opts.organizationId,
          diaSemana: diaCitado,
        });
        if (linhaSemTurno) {
          const labelTurno =
            turno === "manha"
              ? "de manhã"
              : turno === "tarde"
                ? "à tarde"
                : "à noite";
          return `${saudacao}não tenho horário livre ${labelTurno} na próxima ${NOMES_DIAS_LISTA[diaCitado]}. ${linhaSemTurno}`;
        }
      }
      return `${saudacao}atendemos ${NOMES_DIAS_LISTA[diaCitado]}, mas não tenho horário livre na próxima. Pode escolher outro dia? Atendemos ${dias}.`;
    }
    return `${saudacao}atendemos sim! ${linha}`;
  }

  // Caso 3: pergunta geral sem dia citado — SEMPRE pergunta qual dia primeiro
  return `${saudacao}qual dia funciona melhor pra você? Atendemos ${dias}.`;
}
