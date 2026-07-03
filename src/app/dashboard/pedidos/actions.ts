"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logarEvento } from "@/lib/caio/eventos";
import type { ItemPedido } from "@/lib/caio/extrator-pedido";

/**
 * Server actions da fila de pedidos. Padrão do projeto: o acesso é validado
 * lendo o pedido com o client do usuário (RLS de select cobre a org);
 * a escrita vai pelo admin client (tabela não tem policy de escrita).
 */

async function carregarPedido(pedidoId: string): Promise<
  | {
      pedido: {
        id: string;
        organization_id: string;
        lead_id: string;
        status: string;
        itens: ItemPedido[];
        agendamento_id: string | null;
        updated_at: string;
      };
      usuarioNome: string | null;
    }
  | { error: string }
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Não autenticado" };

  const { data: pedido, error } = await supabase
    .from("pedidos")
    .select("id, organization_id, lead_id, status, itens, agendamento_id, updated_at")
    .eq("id", pedidoId)
    .single();
  if (error || !pedido) return { error: "Pedido não encontrado (ou sem acesso)" };

  const { data: profile } = await supabase
    .from("profiles")
    .select("nome")
    .eq("id", user.id)
    .single();

  return { pedido, usuarioNome: profile?.nome ?? null };
}

function revalidar(leadId: string) {
  revalidatePath("/dashboard/pedidos");
  revalidatePath(`/dashboard/contatos/${leadId}`);
  revalidatePath("/dashboard");
}

export async function assumirPedido(
  pedidoId: string,
): Promise<{ ok: true } | { error: string }> {
  const ctx = await carregarPedido(pedidoId);
  if ("error" in ctx) return ctx;

  const admin = createAdminClient();
  const { data: linha, error } = await admin
    .from("pedidos")
    .update({ status: "em_atendimento" })
    .eq("id", pedidoId)
    .in("status", ["captando", "pronto_para_equipe"])
    .select("id")
    .maybeSingle();
  if (error) return { error: error.message };
  if (!linha) return { error: "Esse pedido já foi movido — atualiza a página." };

  await logarEvento({
    leadId: ctx.pedido.lead_id,
    organizationId: ctx.pedido.organization_id,
    tipo: "pedido_alterado",
    descricao: "Atendente assumiu o pedido.",
    autorNome: ctx.usuarioNome,
    meta: { pedido_id: pedidoId, acao: "assumir" },
  });
  revalidar(ctx.pedido.lead_id);
  return { ok: true };
}

export async function finalizarPedido(
  pedidoId: string,
  opts?: { marcarLeadFechou?: boolean },
): Promise<{ ok: true } | { error: string }> {
  const ctx = await carregarPedido(pedidoId);
  if ("error" in ctx) return ctx;

  const admin = createAdminClient();
  const { data: linha, error } = await admin
    .from("pedidos")
    .update({ status: "finalizado", finalizado_em: new Date().toISOString() })
    .eq("id", pedidoId)
    .in("status", ["captando", "pronto_para_equipe", "em_atendimento"])
    .select("id")
    .maybeSingle();
  if (error) return { error: error.message };
  if (!linha) return { error: "Esse pedido já foi encerrado — atualiza a página." };

  if (opts?.marcarLeadFechou) {
    const { error: leadErr } = await admin
      .from("leads")
      .update({ status: "fechou" })
      .eq("id", ctx.pedido.lead_id);
    if (leadErr) {
      // Pedido já finalizou — não desfaz, mas não engole: o operador vê que
      // o status do lead não acompanhou.
      console.warn("[pedidos:finalizar] lead não atualizado:", leadErr.message);
    }
  }

  await logarEvento({
    leadId: ctx.pedido.lead_id,
    organizationId: ctx.pedido.organization_id,
    tipo: "pedido_finalizado",
    descricao: "Pedido finalizado pelo atendente.",
    autorNome: ctx.usuarioNome,
    meta: { pedido_id: pedidoId },
  });
  revalidar(ctx.pedido.lead_id);
  return { ok: true };
}

export async function cancelarPedido(
  pedidoId: string,
  motivo?: string,
): Promise<{ ok: true } | { error: string }> {
  const ctx = await carregarPedido(pedidoId);
  if ("error" in ctx) return ctx;

  const admin = createAdminClient();
  // Motivo NÃO sobrescreve obs (anotações do atendente) — vai só pro evento.
  const { data: linha, error } = await admin
    .from("pedidos")
    .update({
      status: "cancelado",
      finalizado_em: new Date().toISOString(),
    })
    .eq("id", pedidoId)
    .in("status", ["captando", "pronto_para_equipe", "em_atendimento"])
    .select("id")
    .maybeSingle();
  if (error) return { error: error.message };
  if (!linha) return { error: "Esse pedido já foi encerrado — atualiza a página." };

  // Cancela junto a retirada/entrega vinculada (se ainda ativa) — senão ela
  // fica órfã em "Retiradas de hoje" e ainda é herdada por um pedido futuro
  // do mesmo lead via reconciliação do extrator.
  if (ctx.pedido.agendamento_id) {
    await admin
      .from("agendamentos")
      .update({ status: "cancelado" })
      .eq("id", ctx.pedido.agendamento_id)
      .in("status", ["sugerido", "agendado"]);
    revalidatePath("/dashboard/agenda");
  }

  await logarEvento({
    leadId: ctx.pedido.lead_id,
    organizationId: ctx.pedido.organization_id,
    tipo: "pedido_cancelado",
    descricao: `Pedido cancelado pelo atendente${motivo ? `: ${motivo}` : "."}`,
    autorNome: ctx.usuarioNome,
    meta: { pedido_id: pedidoId, motivo: motivo ?? null },
  });
  revalidar(ctx.pedido.lead_id);
  return { ok: true };
}

export async function atualizarPedido(
  pedidoId: string,
  patch: {
    itens?: ItemPedido[];
    modalidade?: "retirada" | "entrega" | null;
    endereco?: string | null;
    nome_cliente?: string | null;
    obs?: string | null;
  },
  // CAS: updated_at que o painel viu ao abrir a edição. Se o pedido mudou
  // nesse meio tempo (extrator gravou item novo do cliente), o save falha
  // com aviso em vez de sobrescrever silenciosamente.
  updatedAtEsperado?: string,
): Promise<{ ok: true } | { error: string }> {
  const ctx = await carregarPedido(pedidoId);
  if ("error" in ctx) return ctx;

  // Valida e RECONSTRÓI os itens (whitelist de chaves — nada de campo forjado
  // indo verbatim pro jsonb; ref inválido quebraria a fila e a notificação).
  let itensLimpos: ItemPedido[] | undefined;
  if (patch.itens) {
    if (patch.itens.length === 0)
      return {
        error:
          "O pedido precisa de ao menos 1 item — pra descartar, use Cancelar pedido.",
      };
    if (patch.itens.length > 30) return { error: "Máximo de 30 itens" };
    itensLimpos = [];
    for (const i of patch.itens) {
      if (!i.produto?.trim()) return { error: "Item sem nome de produto" };
      if (!Number.isFinite(i.quantidade) || i.quantidade <= 0)
        return { error: `Quantidade inválida em "${i.produto}"` };
      if (i.ref != null && typeof i.ref !== "string")
        return { error: "Código de referência inválido" };
      itensLimpos.push({
        produto: String(i.produto).trim().slice(0, 120),
        quantidade: i.quantidade,
        unidade:
          i.unidade && typeof i.unidade === "string"
            ? i.unidade.trim().slice(0, 30) || null
            : null,
        ref:
          typeof i.ref === "string" && i.ref.trim()
            ? i.ref.trim().slice(0, 20)
            : null,
      });
    }
  }
  if (
    patch.modalidade !== undefined &&
    patch.modalidade !== null &&
    patch.modalidade !== "retirada" &&
    patch.modalidade !== "entrega"
  ) {
    return { error: "Modalidade inválida" };
  }

  const admin = createAdminClient();
  let query = admin
    .from("pedidos")
    .update({
      ...(itensLimpos !== undefined ? { itens: itensLimpos } : {}),
      ...(patch.modalidade !== undefined ? { modalidade: patch.modalidade } : {}),
      ...(patch.endereco !== undefined ? { endereco: patch.endereco?.trim() || null } : {}),
      ...(patch.nome_cliente !== undefined
        ? { nome_cliente: patch.nome_cliente?.trim() || null }
        : {}),
      ...(patch.obs !== undefined ? { obs: patch.obs?.trim() || null } : {}),
      editado_pelo_painel: true, // extrator para de sobrescrever
      updated_at: new Date().toISOString(),
    })
    .eq("id", pedidoId)
    .in("status", ["captando", "pronto_para_equipe", "em_atendimento"]);
  if (updatedAtEsperado) query = query.eq("updated_at", updatedAtEsperado);
  const { data: linha, error } = await query.select("id").maybeSingle();
  if (error) return { error: error.message };
  if (!linha) {
    // Distingue CAS perdido de pedido encerrado pra mensagem certa
    if (updatedAtEsperado && ctx.pedido.updated_at !== updatedAtEsperado) {
      return {
        error:
          "O pedido mudou enquanto você editava (o cliente pode ter acrescentado algo). Feche a edição, revise e salve de novo.",
      };
    }
    return { error: "Esse pedido já foi encerrado — atualiza a página." };
  }

  await logarEvento({
    leadId: ctx.pedido.lead_id,
    organizationId: ctx.pedido.organization_id,
    tipo: "pedido_alterado",
    descricao: "Pedido editado pelo atendente no painel.",
    autorNome: ctx.usuarioNome,
    meta: { pedido_id: pedidoId, itens: itensLimpos ?? null },
  });
  revalidar(ctx.pedido.lead_id);
  return { ok: true };
}
