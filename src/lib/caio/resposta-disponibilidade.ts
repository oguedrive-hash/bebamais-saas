/**
 * Resposta determinística pra perguntas do lead sobre dias/horários atendidos.
 *
 * Lê DIRETO da `agenda_config` da org (sem LLM, sem contexto, sem histórico).
 * Objetivo: garantir que a IA nunca diga "não atendemos terça" quando a
 * config diz que sim. LLM era estocástico demais — esse caminho é fixo.
 *
 * Detecta o caso via regex simples no texto do lead. Se bate, gera resposta
 * template e o caller envia direto pelo Chatwoot, pulando `gerarRespostaCaio`.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import {
  AGENDA_CONFIG_DEFAULT,
  getAgendaConfig,
  janelaFuncionamento,
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

// sábado e domingo são masculinos ("no próximo sábado");
// segunda a sexta, femininos ("na próxima terça")
function diaEhMasculino(diaSemana: number): boolean {
  return diaSemana === 6 || diaSemana === 7;
}

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

export function descreverDiasNatural(dias: number[]): string {
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

// Turno tem interseção com a janela de funcionamento da loja?
// (manhã = até 12h, tarde = 12h-18h, noite = 18h em diante)
function turnoDentroDoFuncionamento(
  turno: TurnoDia,
  abre: string,
  fecha: string,
): boolean {
  const min = (hhmm: string) => {
    const [h, m] = hhmm.split(":").map(Number);
    return h * 60 + m;
  };
  const janelas: Record<TurnoDia, [number, number]> = {
    manha: [0, 720],
    tarde: [720, 1080],
    noite: [1080, 1440],
  };
  const [tIni, tFim] = janelas[turno];
  return min(abre) < tFim && min(fecha) > tIni;
}

/**
 * Linha de funcionamento pra um dia da semana específico, sem saudação.
 *
 * Contexto Beba Mais: loja não tem slots de agendamento — o horário do
 * cliente é SUGESTÃO. A gente informa a janela de funcionamento e convida
 * o cliente a dizer o horário dele (a equipe confirma depois).
 *
 * Se `turno` for fornecido e a loja não abre naquele turno, retorna null
 * (o caller explica que naquele turno tá fechado e dá a janela completa).
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

  const oc = encontrarProximaOcorrencia(new Date(), opts.diaSemana);
  if (!oc) return null;

  const { abre, fecha } = janelaFuncionamento(agenda);
  if (opts.turno && !turnoDentroDoFuncionamento(opts.turno, abre, fecha)) {
    return null;
  }

  const artigo = diaEhMasculino(opts.diaSemana) ? "No" : "Na";
  return `${artigo} ${oc.label} a loja fica aberta das ${abre} às ${fecha} — me diz que horas fica melhor pra você que eu já deixo anotado pra equipe.`;
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

  const { abre, fecha } = janelaFuncionamento(agenda);

  // Caso 1: lead mencionou dia em que a loja NÃO abre (ex: domingo)
  if (diaCitado !== null && !agenda.dias_semana.includes(diaCitado)) {
    const nomeDia = NOMES_DIAS_LISTA[diaCitado];
    return `${saudacao}${nomeDia} a loja não abre. Funcionamos ${dias}, das ${abre} às ${fecha}. Qual dia fica melhor pra você?`;
  }

  // Caso 2: dia ATENDIDO — informa a janela de funcionamento (a loja não tem
  // slots; o cliente vem/recebe no horário que preferir e a equipe confirma).
  if (diaCitado !== null && agenda.dias_semana.includes(diaCitado)) {
    const turno = turnoMencionado(opts.conteudoLead ?? null);
    const linha = await gerarLinhaHorariosDoDia({
      organizationId: opts.organizationId,
      diaSemana: diaCitado,
      turno: turno ?? undefined,
    });
    if (linha) return `${saudacao}atendemos sim! ${linha}`;

    // Turno fora do funcionamento (ex: "sábado à noite") → explica e dá a janela
    if (turno) {
      const linhaSemTurno = await gerarLinhaHorariosDoDia({
        organizationId: opts.organizationId,
        diaSemana: diaCitado,
      });
      if (linhaSemTurno) {
        const labelTurno =
          turno === "manha"
            ? "De manhã"
            : turno === "tarde"
              ? "À tarde"
              : "À noite";
        return `${saudacao}${labelTurno.toLowerCase()} a loja não tá aberta. ${linhaSemTurno}`;
      }
    }
    return `${saudacao}a loja abre ${dias}, das ${abre} às ${fecha}. Qual dia e horário ficam melhores pra você?`;
  }

  // Caso 3: pergunta geral sem dia citado — dá o funcionamento e pergunta o dia
  return `${saudacao}a loja abre ${dias}, das ${abre} às ${fecha}. Qual dia fica melhor pra você?`;
}
