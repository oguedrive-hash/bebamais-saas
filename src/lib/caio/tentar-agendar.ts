/**
 * Registra o horário que o CLIENTE sugeriu pra retirada/entrega do pedido.
 *
 * Contexto Beba Mais (03/07/2026): a loja não trabalha com slots de
 * agendamento — o horário do cliente é uma SUGESTÃO. A IA só valida que o
 * momento cai dentro do funcionamento da loja (dia atendido + janela
 * abre/fecha) e grava o agendamento com status "sugerido". Quem confirma com
 * o cliente é a equipe, pelo painel (status → "agendado"). Sem checagem de
 * conflito: a loja atende N clientes ao mesmo tempo.
 *
 * Retorna:
 *  - { ok, agendamento } se anotou
 *  - { error, motivo, funcionamento } se o momento não serve — o caller usa
 *    `funcionamento` pra explicar a janela da loja ao cliente
 */

import { createAdminClient } from "@/lib/supabase/admin";
import {
  AGENDA_CONFIG_DEFAULT,
  getAgendaConfig,
  janelaFuncionamento,
} from "@/lib/caio/agenda-config";
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

export type FuncionamentoInfo = {
  abre: string; // "HH:mm"
  fecha: string; // "HH:mm"
  diasSemana: number[]; // 1=seg ... 7=dom
};

export type ResultadoAgendar =
  | {
      ok: true;
      agendamento: {
        id: string;
        data_inicio: string;
        data_fim: string;
      };
    }
  | {
      error: string;
      motivo:
        | "no_passado"
        | "fora_horizonte"
        | "dia_nao_atendido"
        | "fora_funcionamento"
        | "falha_db";
      funcionamento?: FuncionamentoInfo;
    };

export async function tentarAgendar(opts: {
  organizationId: string;
  leadId: string;
  momento: Date;
}): Promise<ResultadoAgendar> {
  const admin = createAdminClient();

  // 1. Carrega config (dias + janela de funcionamento)
  const { data: org } = await admin
    .from("organizations")
    .select("agenda_config")
    .eq("id", opts.organizationId)
    .single();
  const config = org?.agenda_config
    ? getAgendaConfig(org.agenda_config)
    : AGENDA_CONFIG_DEFAULT;
  const { abre, fecha } = janelaFuncionamento(config);
  const funcionamento: FuncionamentoInfo = {
    abre,
    fecha,
    diasSemana: config.dias_semana,
  };

  const agora = new Date();

  // 2. Momento no passado não serve (o classificador já degrada casos assim,
  // mas fica a rede de segurança)
  if (opts.momento.getTime() < agora.getTime()) {
    return {
      error: "horário já passou",
      motivo: "no_passado",
      funcionamento,
    };
  }

  // 3. Horizonte — sugestão muito longe é melhor a equipe combinar perto da data
  const limiteHorizonte = new Date(
    agora.getTime() + config.horizonte_dias * 86400 * 1000,
  );
  if (opts.momento.getTime() > limiteHorizonte.getTime()) {
    return {
      error: `só anotamos horários pros próximos ${config.horizonte_dias} dias`,
      motivo: "fora_horizonte",
      funcionamento,
    };
  }

  // 4. Dia em que a loja abre?
  const ds = diaSemanaSP(opts.momento);
  if (!config.dias_semana.includes(ds)) {
    return {
      error: "a loja não abre nesse dia",
      motivo: "dia_nao_atendido",
      funcionamento,
    };
  }

  // 5. Dentro da janela de funcionamento? (inicio >= abre e inicio <= fecha —
  // buscar no minuto do fechamento é aceitável, é só sugestão)
  const { ano, mes, dia } = partesEmSP(opts.momento);
  const a = parseHHmm(abre);
  const f = parseHHmm(fecha);
  const abreNoDia = montarUtcDeSP(ano, mes, dia, a.h, a.m);
  const fechaNoDia = montarUtcDeSP(ano, mes, dia, f.h, f.m);
  if (
    opts.momento.getTime() < abreNoDia.getTime() ||
    opts.momento.getTime() > fechaNoDia.getTime()
  ) {
    return {
      error: "horário fora do funcionamento da loja",
      motivo: "fora_funcionamento",
      funcionamento,
    };
  }

  // 6. Anota a sugestão. Duração nominal (só pra exibição no calendário),
  // aparada pra não passar do fechamento.
  const dataInicio = opts.momento;
  const fimNominal = new Date(
    dataInicio.getTime() + config.duracao_padrao * 60 * 1000,
  );
  const dataFim =
    fimNominal.getTime() > fechaNoDia.getTime() ? fechaNoDia : fimNominal;

  const { data: novo, error } = await admin
    .from("agendamentos")
    .insert({
      organization_id: opts.organizationId,
      lead_id: opts.leadId,
      data_inicio: dataInicio.toISOString(),
      data_fim: dataFim.toISOString(),
      status: "sugerido",
    })
    .select("id, data_inicio, data_fim")
    .single();
  if (error || !novo) {
    return {
      error: error?.message ?? "falha ao criar",
      motivo: "falha_db",
      funcionamento,
    };
  }

  // Vincula ao pedido aberto do lead (a retirada/entrega é do PEDIDO).
  // Best-effort com guardas de ownership: não mexe em pedido editado pelo
  // humano, não sobrescreve vínculo, não toca pedido já assumido. A
  // modalidade fica com o extrator (pode ser entrega!).
  await admin
    .from("pedidos")
    .update({ agendamento_id: novo.id })
    .eq("lead_id", opts.leadId)
    .eq("editado_pelo_painel", false)
    .is("agendamento_id", null)
    .in("status", ["captando", "pronto_para_equipe"]);

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
