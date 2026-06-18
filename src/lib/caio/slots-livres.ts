/**
 * Calcula slots de horário disponíveis pro Caio propor ao lead.
 *
 * Respeita:
 *  - agenda_config (modo, dias_semana, slots, duracao_padrao, antecedência,
 *    horizonte)
 *  - agendamentos existentes (não propõe conflito)
 *
 * O modo da config muda a granularidade:
 *  - "slot": cada slot vira um candidato (8h-10h30 = 1 opção inteira)
 *  - "duracao": subdivide a janela em chunks de duracao_padrao consecutivos
 *    (janela 8h-12h + duracao 60min = 4 opções: 8-9, 9-10, 10-11, 11-12)
 */

import { createAdminClient } from "@/lib/supabase/admin";
import {
  AGENDA_CONFIG_DEFAULT,
  getAgendaConfig,
  type AgendaConfig,
} from "@/lib/caio/agenda-config";

export type SlotLivre = {
  inicio: string; // ISO datetime UTC
  fim: string; // ISO datetime UTC
  label: string; // ex: "Qui 12/06 às 14:00"
};

const FUSO = "America/Sao_Paulo";
const UTC_OFFSET_MIN = -180; // -03:00 pra São Paulo (sem horário de verão no BR)

/**
 * Constrói um ISO timestamptz a partir de ano/mes/dia/hora/min no fuso de SP.
 * Subtraindo o offset, geramos o instante UTC equivalente.
 */
function montarUtcDeSP(
  ano: number,
  mes: number,
  dia: number,
  hora: number,
  min: number,
): Date {
  const utc = new Date(Date.UTC(ano, mes - 1, dia, hora, min, 0));
  // SP é UTC-3 → o instante UTC do horário local é "local + 3h"
  utc.setUTCMinutes(utc.getUTCMinutes() - UTC_OFFSET_MIN);
  return utc;
}

/**
 * Retorna dia da semana ISO (1=seg ... 7=dom) no fuso de SP.
 */
function diaSemanaSP(d: Date): number {
  // toLocaleString com timeZone pega o dia certo no fuso de SP
  const wd = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    timeZone: FUSO,
  }).format(d);
  const map: Record<string, number> = {
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
    Sun: 7,
  };
  return map[wd] ?? 1;
}

function labelSlot(d: Date): string {
  const partes = new Intl.DateTimeFormat("pt-BR", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: FUSO,
  }).formatToParts(d);
  const get = (t: string) => partes.find((p) => p.type === t)?.value ?? "";
  const wd = get("weekday").replace(".", "");
  const day = get("day");
  const month = get("month");
  const hour = get("hour");
  const minute = get("minute");
  return `${wd} ${day}/${month} às ${hour}:${minute}`;
}

/**
 * Itera dias do calendário dentro do horizonte, no fuso de SP.
 */
function* diasNoHorizonte(
  agora: Date,
  horizonteDias: number,
): Generator<{ ano: number; mes: number; dia: number; diaSemana: number }> {
  // Pega dia atual em SP
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

  for (let i = 0; i < horizonteDias; i++) {
    // Calcula dia da semana usando montarUtcDeSP às 12h (meio-dia, longe da virada)
    const referencia = montarUtcDeSP(ano, mes, dia, 12, 0);
    const diaSemana = diaSemanaSP(referencia);
    yield { ano, mes, dia, diaSemana };

    // Avança 1 dia (usando JS Date pra lidar com mês/ano corretamente)
    const proxima = new Date(Date.UTC(ano, mes - 1, dia + 1));
    ano = proxima.getUTCFullYear();
    mes = proxima.getUTCMonth() + 1;
    dia = proxima.getUTCDate();
  }
}

function parseHorario(hhmm: string): { hora: number; min: number } {
  const [h, m] = hhmm.split(":").map(Number);
  return { hora: h, min: m };
}

/**
 * Verifica se um intervalo [a_inicio, a_fim) conflita com [b_inicio, b_fim).
 */
function conflita(
  aInicio: Date,
  aFim: Date,
  bInicio: Date,
  bFim: Date,
): boolean {
  return aInicio.getTime() < bFim.getTime() && aFim.getTime() > bInicio.getTime();
}

/**
 * Carrega config + agendamentos existentes e calcula os próximos slots livres.
 *
 * Limita a quantidade ao `qtd_opcoes_propor` da config, por default.
 */
export async function calcularSlotsLivres(opts: {
  organizationId: string;
  qtdMaxima?: number;
  apartirDe?: Date;
  /**
   * Se fornecido (formato "HH:mm"), só retorna slots cujo horário de início
   * BATE com esse. Útil pra "lead pediu 14:00 num dia que não tem — tem 14:00
   * em outro dia?". Quando ativado, NÃO diversifica por turno (a quantidade
   * importa).
   */
  filtrarPorHora?: string;
}): Promise<{ slots: SlotLivre[]; config: AgendaConfig } | { error: string }> {
  const admin = createAdminClient();

  // 1. Config da org
  const { data: org } = await admin
    .from("organizations")
    .select("agenda_config")
    .eq("id", opts.organizationId)
    .single();
  const config = org?.agenda_config
    ? getAgendaConfig(org.agenda_config)
    : AGENDA_CONFIG_DEFAULT;

  const agora = opts.apartirDe ?? new Date();
  const qtdMax = opts.qtdMaxima ?? config.qtd_opcoes_propor;

  // Janela de busca
  const limiteAntecedencia = new Date(
    agora.getTime() + config.antecedencia_minima_horas * 3600 * 1000,
  );
  const limiteHorizonte = new Date(
    agora.getTime() + config.horizonte_dias * 86400 * 1000,
  );

  // 2. Agendamentos existentes no horizonte (status agendado)
  const { data: agendamentosExistentes } = await admin
    .from("agendamentos")
    .select("data_inicio, data_fim")
    .eq("organization_id", opts.organizationId)
    .eq("status", "agendado")
    .gte("data_inicio", agora.toISOString())
    .lte("data_inicio", limiteHorizonte.toISOString());
  const ocupados = (agendamentosExistentes ?? []).map((a) => ({
    inicio: new Date(a.data_inicio),
    fim: new Date(a.data_fim),
  }));

  // 3. Gera candidatos dia a dia (como Date intermediários)
  type Candidato = { inicio: Date; fim: Date };
  const candidatos: Candidato[] = [];

  for (const { ano, mes, dia, diaSemana } of diasNoHorizonte(
    agora,
    config.horizonte_dias,
  )) {
    if (!config.dias_semana.includes(diaSemana)) continue;

    for (const slot of config.slots) {
      const ini = parseHorario(slot.inicio);
      const fim = parseHorario(slot.fim);
      const slotInicio = montarUtcDeSP(ano, mes, dia, ini.hora, ini.min);
      const slotFim = montarUtcDeSP(ano, mes, dia, fim.hora, fim.min);

      if (config.modo === "slot") {
        candidatos.push({ inicio: slotInicio, fim: slotFim });
      } else {
        // Modo duracao: subdivide a janela em chunks consecutivos
        const duracaoMs = config.duracao_padrao * 60 * 1000;
        let cursor = slotInicio.getTime();
        while (cursor + duracaoMs <= slotFim.getTime()) {
          candidatos.push({
            inicio: new Date(cursor),
            fim: new Date(cursor + duracaoMs),
          });
          cursor += duracaoMs;
        }
      }
    }
  }

  // 4. Filtra antecedência + conflitos (+ filtro por hora se fornecido)
  const validos = candidatos.filter((c) => {
    if (c.inicio.getTime() < limiteAntecedencia.getTime()) return false;
    if (opts.filtrarPorHora) {
      const horaLocal = new Intl.DateTimeFormat("en-GB", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
        timeZone: FUSO,
      }).format(c.inicio);
      if (horaLocal !== opts.filtrarPorHora) return false;
    }
    return !ocupados.some((o) =>
      conflita(c.inicio, c.fim, o.inicio, o.fim),
    );
  });

  // Modo "filtrarPorHora": sem diversificação por turno (todos têm a
  // mesma hora). Retorna em ordem cronológica direta.
  if (opts.filtrarPorHora) {
    const livresHora = validos
      .slice(0, qtdMax)
      .map((c) => ({
        inicio: c.inicio.toISOString(),
        fim: c.fim.toISOString(),
        label: labelSlot(c.inicio),
      }));
    return { slots: livresHora, config };
  }

  // 5. Diversifica: tenta 1 por dia (alternando manhã/tarde quando der) antes
  // de repetir dias. Se faltar pra completar qtdMax, repete o próximo dia.
  // Manhã = antes de 12h local, tarde = 12h em diante.
  const porDiaTurno = new Map<string, Candidato[]>();
  for (const c of validos) {
    const horaLocal = Number(
      new Intl.DateTimeFormat("en-US", {
        hour: "2-digit",
        hour12: false,
        timeZone: FUSO,
      }).format(c.inicio),
    );
    const turno = horaLocal < 12 ? "manha" : "tarde";
    const diaKey = new Intl.DateTimeFormat("en-CA", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      timeZone: FUSO,
    }).format(c.inicio);
    const key = `${diaKey}:${turno}`;
    const arr = porDiaTurno.get(key) ?? [];
    arr.push(c);
    porDiaTurno.set(key, arr);
  }

  // Pega no máximo 1 candidato por (dia, turno), ordenado por data. Round 1:
  // manhãs em ordem cronológica. Round 2: tardes em ordem cronológica. Repete.
  const livres: SlotLivre[] = [];
  const usadasDia = new Set<string>();
  const turnos = ["manha", "tarde"];
  for (let round = 0; round < 5 && livres.length < qtdMax; round++) {
    for (const turno of turnos) {
      if (livres.length >= qtdMax) break;
      const candidatosTurno = Array.from(porDiaTurno.entries())
        .filter(([k]) => k.endsWith(`:${turno}`))
        .sort((a, b) => a[0].localeCompare(b[0]));
      for (const [k, arr] of candidatosTurno) {
        if (livres.length >= qtdMax) break;
        const dia = k.split(":")[0];
        // Permite repetir dia só a partir do round 2
        if (round < 2 && usadasDia.has(dia)) continue;
        const idx = round; // 0 = primeiro do turno daquele dia, 1 = segundo, etc
        const escolhido = arr[idx];
        if (!escolhido) continue;
        livres.push({
          inicio: escolhido.inicio.toISOString(),
          fim: escolhido.fim.toISOString(),
          label: labelSlot(escolhido.inicio),
        });
        usadasDia.add(dia);
      }
    }
  }

  // Reordena cronologicamente pra ficar coerente na mensagem do Caio
  livres.sort((a, b) => a.inicio.localeCompare(b.inicio));

  return { slots: livres, config };
}
