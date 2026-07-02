"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logarEvento } from "@/lib/caio/eventos";

export type RelatorioVoltar = {
  movidos: number;
  pulados: { leadId: string; nome: string | null; motivo: string }[];
};

/**
 * Move leads pra origem=inbound, status=em_conversa, IA LIGADA.
 *
 * Usado quando o operador quer tirar contato(s) do fluxo de prospecção
 * (parar cadência outbound) e deixar a IA responder se o cliente mandar
 * msg. Tambem da pra usar pra reverter um lead movido por engano.
 *
 * Mantem chatwoot_conversation_id existente — não cria conversa nova.
 * origem_inicial nunca muda (registro histórico de como o lead realmente
 * entrou pela primeira vez).
 */
export async function moverLeadsParaInbound(
  leadIds: string[],
): Promise<{ ok: true; relatorio: RelatorioVoltar } | { error: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Não autenticado" };

  if (leadIds.length === 0) {
    return { ok: true, relatorio: { movidos: 0, pulados: [] } };
  }

  const { data: leadsVisiveis, error } = await supabase
    .from("leads")
    .select("id, nome, status, origem, organization_id")
    .in("id", leadIds);
  if (error) return { error: error.message };
  if (!leadsVisiveis || leadsVisiveis.length === 0) {
    return { error: "Nenhum lead acessível" };
  }

  const admin = createAdminClient();
  const relatorio: RelatorioVoltar = { movidos: 0, pulados: [] };

  for (const lead of leadsVisiveis) {
    if (lead.origem === "inbound") {
      relatorio.pulados.push({
        leadId: lead.id,
        nome: lead.nome,
        motivo: "já estava em inbound",
      });
      continue;
    }

    const { error: upErr } = await admin
      .from("leads")
      .update({
        origem: "inbound",
        status: "em_conversa",
        caio_ativo: true,
        followup_ativo: true,
        // Para qualquer cadência outbound que estivesse rodando
        proximo_contato_em: null,
        // Reseta contadores pra que, se voltar pra prospecção depois, comece limpo
        numero_prospeccao: 0,
        numero_followup: 0,
        numero_reativacao: 0,
        proximo_followup_em: null,
      })
      .eq("id", lead.id);
    if (upErr) {
      relatorio.pulados.push({
        leadId: lead.id,
        nome: lead.nome,
        motivo: `falha update: ${upErr.message}`,
      });
      continue;
    }

    await logarEvento({
      leadId: lead.id,
      organizationId: lead.organization_id,
      tipo: "status_mudou",
      descricao: `Lead movido pra Inbound (origem ${lead.origem ?? "?"} → inbound, status → em_conversa)`,
      autorNome: user.email ?? null,
    });

    relatorio.movidos++;
  }

  revalidatePath("/dashboard/contatos");
  revalidatePath("/dashboard/leads");
  revalidatePath("/dashboard/prospeccao");
  for (const id of leadIds) {
    revalidatePath(`/dashboard/contatos/${id}`);
  }
  return { ok: true, relatorio };
}
