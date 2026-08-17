"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getJanela } from "@/lib/caio/janela-prospeccao";
import { digitosTelefone } from "@/lib/caio/telefone";
import {
  calcularOffsetsRajada,
  CADENCIA_DEFAULT,
} from "@/lib/caio/cadencia-rajada";

export type RelatorioDisparo = {
  agendados: number;
  falhas: { leadId: string; nome: string | null; motivo: string }[];
};

const OFFSET_PRIMEIRO_SEGUNDOS = 5;

/**
 * Agenda a primeira mensagem da cadência pros leads selecionados.
 *
 * Diferente da versão anterior, NÃO dispara nada de dentro da action — só
 * marca `proximo_contato_em` e deixa o cron de prospecção fazer o trabalho.
 * Por que? O cron sempre rodou bem (o calcularProximoEm acerta o delay da
 * regra 2, etc.). Quando a action chamava `processarProspeccaoLead` direto,
 * algo no caminho da server action introduzia um delay extra de ~3-4 min no
 * proximo_contato_em da regra 2. Agendar pelo `proximo_contato_em` evita o
 * caminho problemático: o cron pega em segundos (até 1 min do tick) e usa o
 * mesmo path que já funciona pra cadência inteira.
 *
 * Fluxo:
 *  - 1º lead da org → proximo_contato_em = now + 5s (cron pega no próximo tick)
 *  - 2º lead da org → now + 1 * intervalo_minutos
 *  - 3º lead da org → now + 2 * intervalo_minutos
 *  - ...
 *
 * Org separada tem fila própria (multi-tenant).
 */
export async function dispararPrimeirasMensagensEmLote(
  leadIds: string[],
): Promise<{ ok: true; relatorio: RelatorioDisparo } | { error: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Não autenticado" };

  if (leadIds.length === 0) {
    return { ok: true, relatorio: { agendados: 0, falhas: [] } };
  }

  const { data: leadsVisiveis, error } = await supabase
    .from("leads")
    .select(
      "id, nome, telefone, organization_id, origem",
    )
    .in("id", leadIds)
    .eq("origem", "prospeccao");

  if (error) return { error: error.message };
  if (!leadsVisiveis || leadsVisiveis.length === 0) {
    return { error: "Nenhum lead acessível" };
  }

  const relatorio: RelatorioDisparo = { agendados: 0, falhas: [] };

  // Detecta conflito de telefone duplicado em outro lead da mesma org
  // (Chatwoot rotearia msg pra conversa errada).
  const admin = createAdminClient();
  const orgIds = Array.from(
    new Set(leadsVisiveis.map((l) => l.organization_id)),
  );
  const { data: todosDaOrg } = await admin
    .from("leads")
    .select("id, telefone, nome, origem")
    .in("organization_id", orgIds);
  const conflitosPorLead = new Map<
    string,
    { nome: string | null; origem: string | null }
  >();
  if (todosDaOrg) {
    const porDigitos = new Map<
      string,
      { id: string; nome: string | null; origem: string | null }[]
    >();
    for (const l of todosDaOrg) {
      const k = digitosTelefone(l.telefone);
      if (!k) continue;
      const arr = porDigitos.get(k) ?? [];
      arr.push({ id: l.id, nome: l.nome, origem: l.origem });
      porDigitos.set(k, arr);
    }
    for (const lead of leadsVisiveis) {
      const k = digitosTelefone(lead.telefone);
      const matches = (porDigitos.get(k) ?? []).filter((m) => m.id !== lead.id);
      if (matches.length > 0) {
        conflitosPorLead.set(lead.id, matches[0]);
      }
    }
  }

  // Le intervalo configurado por org
  const intervaloPorOrg = new Map<string, number>();
  for (const orgId of orgIds) {
    const { data: org } = await admin
      .from("organizations")
      .select("prospeccao_janela")
      .eq("id", orgId)
      .single();
    const janela = getJanela(org?.prospeccao_janela);
    intervaloPorOrg.set(orgId, janela.intervalo_minutos);
  }

  // Cadência em rajada: offsets pré-calculados POR ORG (a cadência é da conta
  // que dispara, não do lote global) e consumidos por índice dentro do loop.
  // Substitui o antigo `idx * intervalo` (mesmo gap N vezes = assinatura de bot).
  const totalPorOrg = new Map<string, number>();
  for (const lead of leadsVisiveis) {
    if (conflitosPorLead.get(lead.id)) continue; // conflito não dispara
    totalPorOrg.set(
      lead.organization_id,
      (totalPorOrg.get(lead.organization_id) ?? 0) + 1,
    );
  }
  const offsetsPorOrg = new Map<string, number[]>();
  for (const [orgId, total] of totalPorOrg) {
    offsetsPorOrg.set(
      orgId,
      calcularOffsetsRajada(
        total,
        CADENCIA_DEFAULT,
        Math.random,
        OFFSET_PRIMEIRO_SEGUNDOS,
      ),
    );
  }

  // Contador por org pra calcular o offset de cada lead na fila
  const indicePorOrg = new Map<string, number>();

  for (const lead of leadsVisiveis) {
    const conflito = conflitosPorLead.get(lead.id);
    if (conflito) {
      relatorio.falhas.push({
        leadId: lead.id,
        nome: lead.nome,
        motivo: `telefone ${lead.telefone} já existe em outro lead (${conflito.nome ?? "?"} / origem ${conflito.origem ?? "?"}). Não disparei pra evitar conflito de conversa no WhatsApp. Remova o lead duplicado primeiro.`,
      });
      continue;
    }

    const orgId = lead.organization_id;
    const intervalo = intervaloPorOrg.get(orgId) ?? 2;
    const idx = indicePorOrg.get(orgId) ?? 0;
    indicePorOrg.set(orgId, idx + 1);

    // Offset da cadência em rajada (pré-calculado por org). Fallback linear se
    // algo falhar — melhor espaçado que junto.
    // IMPORTANTE: usa now() do DB via RPC pra evitar clock drift. Quando
    // calculávamos com Date.now() em JS na server action, o resultado vinha
    // ~3 min adiantado em relação ao now() do Postgres (Next.js 16 parece
    // cachear o tempo da request).
    const offsets = offsetsPorOrg.get(orgId);
    const segundos =
      offsets?.[idx] ?? (idx === 0 ? OFFSET_PRIMEIRO_SEGUNDOS : idx * intervalo * 60);

    const { error: upErr } = await admin.rpc("agendar_disparo_prospeccao", {
      p_lead_id: lead.id,
      p_seconds: segundos,
    });
    if (upErr) {
      relatorio.falhas.push({
        leadId: lead.id,
        nome: lead.nome,
        motivo: `erro ao agendar: ${upErr.message}`,
      });
      continue;
    }
    relatorio.agendados++;
  }

  revalidatePath("/dashboard/prospeccao");
  return { ok: true, relatorio };
}
