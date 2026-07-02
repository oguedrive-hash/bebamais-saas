"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { cookies } from "next/headers";
import {
  AGENDA_CONFIG_DEFAULT,
  getAgendaConfig,
  type AgendaConfig,
  type SlotHorario,
} from "@/lib/caio/agenda-config";
import {
  calcularSlotsLivres,
  type SlotLivre,
} from "@/lib/caio/slots-livres";

const STATUS_VALIDOS = ["agendado", "realizado", "no_show", "cancelado"];

const RE_HORARIO = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

export async function salvarAgendaConfig(
  config: AgendaConfig,
): Promise<{ ok: true } | { error: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Não autenticado" };

  // Pega org do operador
  const { data: profile } = await supabase
    .from("profiles")
    .select("organization_id")
    .eq("id", user.id)
    .single();
  const organizationId = profile?.organization_id as string | undefined;
  if (!organizationId) return { error: "Sem organização vinculada" };

  // Valida
  const diasValidos = config.dias_semana
    .filter((d) => Number.isInteger(d) && d >= 1 && d <= 7)
    .sort();
  if (diasValidos.length === 0) {
    return { error: "Selecione pelo menos 1 dia da semana" };
  }
  const slotsValidos: SlotHorario[] = [];
  for (const s of config.slots) {
    if (!RE_HORARIO.test(s.inicio) || !RE_HORARIO.test(s.fim)) {
      return { error: `Horário inválido: "${s.inicio}" - "${s.fim}"` };
    }
    if (s.inicio >= s.fim) {
      return {
        error: `Início precisa ser antes do fim em ${s.inicio} - ${s.fim}`,
      };
    }
    slotsValidos.push({ inicio: s.inicio, fim: s.fim });
  }
  if (slotsValidos.length === 0) {
    return { error: "Adicione pelo menos 1 slot de horário" };
  }
  // Ordena slots por horário de início pra exibição consistente
  slotsValidos.sort((a, b) => a.inicio.localeCompare(b.inicio));

  // Valida durações
  const duracoesValidas = Array.from(
    new Set(
      config.duracoes.filter(
        (n) => Number.isInteger(n) && n >= 5 && n <= 480,
      ),
    ),
  ).sort((a, b) => a - b);
  if (duracoesValidas.length === 0) {
    return { error: "Adicione pelo menos 1 duração (5-480 min)" };
  }

  // Modo é "slot" ou "duracao"
  const modo = config.modo === "duracao" ? "duracao" : "slot";

  // Duração padrão precisa estar na lista
  if (!duracoesValidas.includes(config.duracao_padrao)) {
    return {
      error: `Duração padrão ${config.duracao_padrao} min precisa estar na lista de durações`,
    };
  }

  // Validação dos números das configs extras
  if (
    !Number.isFinite(config.antecedencia_minima_horas) ||
    config.antecedencia_minima_horas < 0 ||
    config.antecedencia_minima_horas > 168
  ) {
    return { error: "Antecedência mínima precisa ser entre 0 e 168 horas (7 dias)" };
  }
  if (
    !Number.isInteger(config.horizonte_dias) ||
    config.horizonte_dias < 1 ||
    config.horizonte_dias > 365
  ) {
    return { error: "Horizonte precisa ser entre 1 e 365 dias" };
  }
  if (
    !Number.isInteger(config.qtd_opcoes_propor) ||
    config.qtd_opcoes_propor < 1 ||
    config.qtd_opcoes_propor > 10
  ) {
    return { error: "Quantidade de opções a propor precisa ser entre 1 e 10" };
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("organizations")
    .update({
      agenda_config: {
        modo,
        dias_semana: diasValidos,
        slots: slotsValidos,
        duracoes: duracoesValidas,
        duracao_padrao: config.duracao_padrao,
        antecedencia_minima_horas: config.antecedencia_minima_horas,
        horizonte_dias: config.horizonte_dias,
        qtd_opcoes_propor: config.qtd_opcoes_propor,
      },
    })
    .eq("id", organizationId);
  if (error) return { error: error.message };

  revalidatePath("/dashboard/agenda");
  revalidatePath("/dashboard/agenda/config");
  return { ok: true };
}

/**
 * Pré-visualiza os próximos slots livres pra IA propor ao lead.
 * Usado pelo botão "Ver próximos slots" na página de config — mostra o que
 * a IA faria AGORA com a config atual.
 */
export async function previewSlotsLivres(): Promise<
  { ok: true; slots: SlotLivre[] } | { error: string }
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Não autenticado" };

  const { data: profile } = await supabase
    .from("profiles")
    .select("organization_id")
    .eq("id", user.id)
    .single();
  const organizationId = profile?.organization_id as string | undefined;
  if (!organizationId) return { error: "Sem organização vinculada" };

  const result = await calcularSlotsLivres({ organizationId, qtdMaxima: 10 });
  if ("error" in result) return { error: result.error };
  return { ok: true, slots: result.slots };
}

export async function getAgendaConfigDaOrg(): Promise<{
  config: AgendaConfig;
  default: boolean;
}> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { config: AGENDA_CONFIG_DEFAULT, default: true };

  const { data: profile } = await supabase
    .from("profiles")
    .select("organization_id")
    .eq("id", user.id)
    .single();
  const organizationId = profile?.organization_id as string | undefined;
  if (!organizationId) return { config: AGENDA_CONFIG_DEFAULT, default: true };

  const { data: org } = await supabase
    .from("organizations")
    .select("agenda_config")
    .eq("id", organizationId)
    .single();

  if (!org?.agenda_config) {
    return { config: AGENDA_CONFIG_DEFAULT, default: true };
  }
  return { config: getAgendaConfig(org.agenda_config), default: false };
}

/**
 * Cria agendamento manualmente pela UI. Operador escolhe lead, data/hora,
 * duração e (opcional) observações. Status inicial = "agendado".
 *
 * Validação: data_inicio precisa ser no futuro. data_fim derivada da duração.
 */
export async function criarAgendamento(
  formData: FormData,
): Promise<{ ok: true; id: string } | { error: string }> {
  const leadId = formData.get("leadId");
  const dataHora = formData.get("dataHora");
  const duracaoMin = formData.get("duracaoMin");
  const observacoes = formData.get("observacoes");

  if (typeof leadId !== "string" || !leadId) {
    return { error: "Selecione um lead" };
  }
  if (typeof dataHora !== "string" || !dataHora) {
    return { error: "Informe data e hora" };
  }
  const dataInicio = new Date(dataHora);
  if (Number.isNaN(dataInicio.getTime())) {
    return { error: "Data/hora inválida" };
  }
  if (dataInicio.getTime() < Date.now()) {
    return { error: "Data/hora precisa ser no futuro" };
  }
  const duracao = Number(duracaoMin);
  if (!Number.isFinite(duracao) || duracao < 5 || duracao > 480) {
    return { error: "Duração inválida (entre 5 e 480 minutos)" };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Não autenticado" };

  // Pega organization do lead via RLS (operador só vê os dele)
  const { data: lead } = await supabase
    .from("leads")
    .select("id, organization_id")
    .eq("id", leadId)
    .single();
  if (!lead) return { error: "Lead não encontrado ou sem acesso" };

  const dataFim = new Date(dataInicio.getTime() + duracao * 60 * 1000);

  const admin = createAdminClient();
  const { data: novo, error } = await admin
    .from("agendamentos")
    .insert({
      organization_id: lead.organization_id,
      lead_id: lead.id,
      data_inicio: dataInicio.toISOString(),
      data_fim: dataFim.toISOString(),
      status: "agendado",
      observacoes:
        typeof observacoes === "string" && observacoes.trim()
          ? observacoes.trim()
          : null,
    })
    .select("id")
    .single();

  if (error || !novo) {
    return { error: error?.message ?? "Falha ao criar agendamento" };
  }

  revalidatePath("/dashboard/agenda");
  revalidatePath(`/dashboard/contatos/${lead.id}`);
  return { ok: true, id: novo.id };
}

/**
 * Busca leads pelo nome ou telefone — usado pelo autocomplete do form
 * "Novo agendamento". Limit 10 pra não sobrecarregar a UI.
 */
export async function buscarLeadsParaAgendamento(
  query: string,
): Promise<{ leads: { id: string; nome: string | null; telefone: string }[] } | { error: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Não autenticado" };

  const q = query.trim();
  if (q.length < 2) return { leads: [] };

  // Busca em nome OR telefone — RLS filtra pela org
  const { data, error } = await supabase
    .from("leads")
    .select("id, nome, telefone")
    .or(`nome.ilike.%${q}%,telefone.ilike.%${q}%`)
    .order("updated_at", { ascending: false })
    .limit(10);

  if (error) return { error: error.message };
  return { leads: data ?? [] };
}

/**
 * Deleta um agendamento permanentemente. Usado pelo botão "🗑️ Deletar" na
 * agenda. Ação irreversível — UI faz confirmação antes.
 *
 * Libera o slot pra que outro lead possa agendar nesse horário.
 */
export async function deletarAgendamento(
  formData: FormData,
): Promise<{ ok: true } | { error: string }> {
  const agendamentoId = formData.get("agendamentoId");
  if (typeof agendamentoId !== "string" || !agendamentoId) {
    return { error: "agendamentoId ausente" };
  }
  const supabase = await createClient();
  const { error } = await supabase
    .from("agendamentos")
    .delete()
    .eq("id", agendamentoId);
  if (error) return { error: error.message };
  revalidatePath("/dashboard/agenda");
  return { ok: true };
}

export async function mudarStatusAgendamento(
  formData: FormData,
): Promise<{ ok: true } | { error: string }> {
  const agendamentoId = formData.get("agendamentoId");
  const novoStatus = formData.get("status");
  if (typeof agendamentoId !== "string" || !agendamentoId) {
    return { error: "agendamentoId ausente" };
  }
  if (typeof novoStatus !== "string" || !STATUS_VALIDOS.includes(novoStatus)) {
    return { error: "status inválido" };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("agendamentos")
    .update({ status: novoStatus })
    .eq("id", agendamentoId);
  if (error) return { error: error.message };

  revalidatePath("/dashboard/agenda");
  return { ok: true };
}

export async function setAgendaView(view: "lista" | "calendario") {
  const c = await cookies();
  c.set("agenda_view_preferida", view, {
    httpOnly: false,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  revalidatePath("/dashboard/agenda");
}
