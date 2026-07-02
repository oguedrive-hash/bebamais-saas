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
    .select("id, organization_id, lead_id, status, itens")
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
    await admin
      .from("leads")
      .update({ status: "fechou" })
      .eq("id", ctx.pedido.lead_id);
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
): Promise<{ ok: true } | { error: string }> {
  const ctx = await carregarPedido(pedidoId);
  if ("error" in ctx) return ctx;

  // Valida e RECONSTRÓI os itens (whitelist de chaves — nada de campo forjado
  // indo verbatim pro jsonb; ref inválido quebraria a fila e a notificação).
  let itensLimpos: ItemPedido[] | undefined;
  if (patch.itens) {
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
  const { data: linha, error } = await admin
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
    })
    .eq("id", pedidoId)
    .in("status", ["captando", "pronto_para_equipe", "em_atendimento"])
    .select("id")
    .maybeSingle();
  if (error) return { error: error.message };
  if (!linha) return { error: "Esse pedido já foi encerrado — atualiza a página." };

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
