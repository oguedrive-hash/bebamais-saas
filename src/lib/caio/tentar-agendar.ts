/**
 * Tenta criar um agendamento pro lead num momento específico.
 *
 * Valida contra `agenda_config` da org:
 *  - dia da semana permitido
 *  - horário cabe num slot/janela
 *  - respeita antecedência mínima
 *  - respeita horizonte máximo
 *  - não conflita com agendamento existente
 *
 * Retorna:
 *  - { ok, agendamento } se criou
 *  - { error, alternativas? } se não pôde — alternativas são slots livres
 *    próximos do momento pedido, pro Caio reoferecer ao lead
 */

import { createAdminClient } from "@/lib/supabase/admin";
import {
  AGENDA_CONFIG_DEFAULT,
  getAgendaConfig,
  type AgendaConfig,
} from "@/lib/caio/agenda-config";
import {
  calcularSlotsLivres,
  type SlotLivre,
} from "@/lib/caio/slots-livres";
import { notificarAdminAgendamento } from "@/lib/caio/notificar-admin";
import { gerarResumoLead } from "@/lib/caio/resumo-ia";

const FUSO = "America/Sao_Paulo";
const UTC_OFFSET_MIN = -180; // -03:00

function partesEmSP(d: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: FUSO,
  }).formatToParts(d);
  const get = (t: string) =>
    Number(parts.find((p) => p.type === t)?.value);
  return {
    ano: get("year"),
    mes: get("month"),
    dia: get("day"),
    hora: get("hour"),
    min: get("minute"),
  };
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

function montarUtcDeSP(
  ano: number,
  mes: number,
  dia: number,
  hora: number,
  min: number,
): Date {
  const utc = new Date(Date.UTC(ano, mes - 1, dia, hora, min, 0));
  utc.setUTCMinutes(utc.getUTCMinutes() - UTC_OFFSET_MIN);
  return utc;
}

function parseHHmm(s: string): { h: number; m: number } {
  const [h, m] = s.split(":").map(Number);
  return { h, m };
}

/**
 * Verifica se o momento desejado encaixa em algum slot/janela da config.
 * Retorna a duração do agendamento (em min) se encaixar, ou null.
 *
 * - Modo "slot": precisa começar exatamente no início de um slot. Duração =
 *   tamanho do slot.
 * - Modo "duracao": precisa cair dentro de uma janela e ter espaço pra
 *   duracao_padrao a partir do momento. Duração = duracao_padrao.
 */
function encaixaNaConfig(
  momento: Date,
  config: AgendaConfig,
): { duracaoMin: number } | null {
  const { ano, mes, dia, hora, min } = partesEmSP(momento);

  for (const slot of config.slots) {
    const ini = parseHHmm(slot.inicio);
    const fim = parseHHmm(slot.fim);
    const slotInicio = montarUtcDeSP(ano, mes, dia, ini.h, ini.m);
    const slotFim = montarUtcDeSP(ano, mes, dia, fim.h, fim.m);

    if (config.modo === "slot") {
      // Precisa começar exatamente no inicio do slot (tolerância de 1 min)
      const diffMs = Math.abs(momento.getTime() - slotInicio.getTime());
      if (diffMs <= 60 * 1000) {
        const duracaoMin = Math.round(
          (slotFim.getTime() - slotInicio.getTime()) / 60000,
        );
        return { duracaoMin };
      }
    } else {
      // duracao: precisa caber inteiro dentro da janela
      const fimMomento = new Date(
        momento.getTime() + config.duracao_padrao * 60 * 1000,
      );
      if (
        momento.getTime() >= slotInicio.getTime() &&
        fimMomento.getTime() <= slotFim.getTime()
      ) {
        // valida também que cai num "tick" da grade de duração
        // (ex: janela 8h-12h + duracao 60 → 8:00, 9:00, 10:00, 11:00)
        const minutosDesdeInicio = Math.round(
          (momento.getTime() - slotInicio.getTime()) / 60000,
        );
        if (minutosDesdeInicio % config.duracao_padrao === 0) {
          return { duracaoMin: config.duracao_padrao };
        }
      }
    }

    // Ignorou o horario, mas o dia/horario pediu pode ser inválido — segue
    // tentando os outros slots. Variáveis acima só usadas no escopo desse loop.
    void hora;
    void min;
  }
  return null;
}

export type ResultadoAgendar =
  | {
      ok: true;
      agendamento: {
        id: string;
        data_inicio: string;
        data_fim: string;
      };
    }
  | { error: string; motivo: "antes_antecedencia" | "fora_horizonte" | "dia_nao_atendido" | "fora_slot" | "conflito" | "falha_db"; alternativas?: SlotLivre[] };

export async function tentarAgendar(opts: {
  organizationId: string;
  leadId: string;
  momento: Date;
}): Promise<ResultadoAgendar> {
  const admin = createAdminClient();

  // 1. Carrega config
  const { data: org } = await admin
    .from("organizations")
    .select("agenda_config")
    .eq("id", opts.organizationId)
    .single();
  const config = org?.agenda_config
    ? getAgendaConfig(org.agenda_config)
    : AGENDA_CONFIG_DEFAULT;

  const agora = new Date();

  // 2. Validações temporais
  const limiteAntecedencia = new Date(
    agora.getTime() + config.antecedencia_minima_horas * 3600 * 1000,
  );
  const limiteHorizonte = new Date(
    agora.getTime() + config.horizonte_dias * 86400 * 1000,
  );
  if (opts.momento.getTime() < limiteAntecedencia.getTime()) {
    const alt = await calcularSlotsLivres({
      organizationId: opts.organizationId,
      qtdMaxima: config.qtd_opcoes_propor,
    });
    return {
      error: `precisa ser ao menos ${config.antecedencia_minima_horas}h no futuro`,
      motivo: "antes_antecedencia",
      alternativas: "slots" in alt ? alt.slots : undefined,
    };
  }
  if (opts.momento.getTime() > limiteHorizonte.getTime()) {
    return {
      error: `só agendamos nos próximos ${config.horizonte_dias} dias`,
      motivo: "fora_horizonte",
    };
  }

  // 3. Dia da semana permitido?
  const ds = diaSemanaSP(opts.momento);
  if (!config.dias_semana.includes(ds)) {
    const alt = await calcularSlotsLivres({
      organizationId: opts.organizationId,
      qtdMaxima: config.qtd_opcoes_propor,
    });
    return {
      error: "não atendemos nesse dia da semana",
      motivo: "dia_nao_atendido",
      alternativas: "slots" in alt ? alt.slots : undefined,
    };
  }

  // 4. Encaixa em algum slot/janela?
  const encaixa = encaixaNaConfig(opts.momento, config);
  if (!encaixa) {
    // NÃO passa apartirDe: opts.momento — isso fazia o limite de antecedência
    // mínima (2h) ser calculado A PARTIR do momento pedido pelo lead, o que
    // descartava o resto do dia se o lead pedisse no fim. Usa o now() normal.
    const alt = await calcularSlotsLivres({
      organizationId: opts.organizationId,
      qtdMaxima: config.qtd_opcoes_propor,
    });
    return {
      error: "horário não cabe nos slots configurados",
      motivo: "fora_slot",
      alternativas: "slots" in alt ? alt.slots : undefined,
    };
  }

  const dataInicio = opts.momento;
  const dataFim = new Date(dataInicio.getTime() + encaixa.duracaoMin * 60 * 1000);

  // 5. Conflito com agendamento existente?
  const { data: conflitos } = await admin
    .from("agendamentos")
    .select("id, data_inicio, data_fim")
    .eq("organization_id", opts.organizationId)
    .eq("status", "agendado")
    .lt("data_inicio", dataFim.toISOString())
    .gt("data_fim", dataInicio.toISOString());
  if (conflitos && conflitos.length > 0) {
    // NÃO passa apartirDe: opts.momento — isso fazia o limite de antecedência
    // mínima (2h) ser calculado A PARTIR do momento pedido pelo lead, o que
    // descartava o resto do dia se o lead pedisse no fim. Usa o now() normal.
    const alt = await calcularSlotsLivres({
      organizationId: opts.organizationId,
      qtdMaxima: config.qtd_opcoes_propor,
    });
    return {
      error: "já tem outro agendamento nesse horário",
      motivo: "conflito",
      alternativas: "slots" in alt ? alt.slots : undefined,
    };
  }

  // 6. Cria
  const { data: novo, error } = await admin
    .from("agendamentos")
    .insert({
      organization_id: opts.organizationId,
      lead_id: opts.leadId,
      data_inicio: dataInicio.toISOString(),
      data_fim: dataFim.toISOString(),
      status: "agendado",
    })
    .select("id, data_inicio, data_fim")
    .single();
  if (error || !novo) {
    return { error: error?.message ?? "falha ao criar", motivo: "falha_db" };
  }

  // Em background: gera resumo IA do lead e notifica o admin no WhatsApp.
  // Fire-and-forget pra nao atrasar a resposta pro lead.
  void (async () => {
    try {
      const { data: lead } = await admin
        .from("leads")
        .select("nome, telefone")
        .eq("id", opts.leadId)
        .single();
      if (!lead) return;
      const resumoRes = await gerarResumoLead({
        leadId: opts.leadId,
        salvar: true,
      });
      const resumoIA = "resumo" in resumoRes ? resumoRes.resumo : null;
      await notificarAdminAgendamento({
        organizationId: opts.organizationId,
        leadId: opts.leadId,
        leadNome: lead.nome ?? null,
        leadTelefone: lead.telefone,
        dataInicio: novo.data_inicio,
        resumoIA,
      });
    } catch (err) {
      console.warn(
        "[tentar-agendar] falha ao notificar admin:",
        err instanceof Error ? err.message : String(err),
      );
    }
  })();

  return { ok: true, agendamento: novo };
}
