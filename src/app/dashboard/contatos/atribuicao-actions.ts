"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logarEvento } from "@/lib/caio/eventos";

/**
 * Atribuição de conversa a um atendente (reunião Beba Mais 07/2026, item 8).
 *
 * "Pegar" a conversa a tira da fila de não-atribuídas dos outros atendentes e
 * registra quem assumiu (responsabilização). Escrita exclusiva: só dá pra
 * pegar uma conversa que está livre — se outro atendente já pegou, retorna
 * quem está com ela (surfaça a "competição" em vez de sobrescrever em silêncio).
 */

type Supa = Awaited<ReturnType<typeof createClient>>;

async function contextoUsuario(): Promise<
  | { ok: false; error: string }
  | { ok: true; supabase: Supa; userId: string; nome: string }
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Não autenticado" };
  // Próprio profile — a policy de RLS de profiles permite ler o próprio.
  const { data: profile } = await supabase
    .from("profiles")
    .select("nome")
    .eq("id", user.id)
    .maybeSingle();
  return {
    ok: true,
    supabase,
    userId: user.id,
    nome: profile?.nome?.trim() || "Atendente",
  };
}

export async function atribuirConversa(
  leadId: string,
): Promise<{ ok: true } | { error: string }> {
  if (!leadId) return { error: "leadId ausente" };
  const ctx = await contextoUsuario();
  if (!ctx.ok) return { error: ctx.error };

  const supabase = ctx.supabase;
  const { data: lead } = await supabase
    .from("leads")
    .select("id, organization_id, atribuido_a, atribuido_nome")
    .eq("id", leadId)
    .single();
  if (!lead) return { error: "Conversa não encontrada (ou sem acesso)" };

  // Já é minha → idempotente, nada a fazer.
  if (lead.atribuido_a === ctx.userId) return { ok: true };
  // Já é de outro atendente → não rouba; avisa quem está com ela.
  if (lead.atribuido_a) {
    return {
      error: `Esta conversa já está com ${lead.atribuido_nome ?? "outro atendente"}.`,
    };
  }

  const admin = createAdminClient();
  // Guarda de corrida: só pega se ainda estiver livre (dois atendentes clicando
  // ao mesmo tempo — quem chegar depois casa 0 linhas e recebe o aviso).
  const { data: linha } = await admin
    .from("leads")
    .update({
      atribuido_a: ctx.userId,
      atribuido_nome: ctx.nome,
      atribuido_em: new Date().toISOString(),
    })
    .eq("id", leadId)
    .is("atribuido_a", null)
    .select("id")
    .maybeSingle();
  if (!linha) {
    const { data: atual } = await admin
      .from("leads")
      .select("atribuido_nome")
      .eq("id", leadId)
      .maybeSingle();
    return {
      error: `Esta conversa já está com ${atual?.atribuido_nome ?? "outro atendente"}.`,
    };
  }

  await logarEvento({
    leadId,
    organizationId: lead.organization_id,
    tipo: "conversa_atribuida",
    descricao: `Conversa assumida por ${ctx.nome}.`,
    autorId: ctx.userId,
    autorNome: ctx.nome,
  });

  revalidatePath("/dashboard/contatos");
  revalidatePath(`/dashboard/contatos/${leadId}`);
  return { ok: true };
}

export async function liberarConversa(
  leadId: string,
): Promise<{ ok: true } | { error: string }> {
  if (!leadId) return { error: "leadId ausente" };
  const ctx = await contextoUsuario();
  if (!ctx.ok) return { error: ctx.error };

  const supabase = ctx.supabase;
  const { data: lead } = await supabase
    .from("leads")
    .select("id, organization_id, atribuido_a")
    .eq("id", leadId)
    .single();
  if (!lead) return { error: "Conversa não encontrada (ou sem acesso)" };
  if (!lead.atribuido_a) return { ok: true }; // já está livre

  const admin = createAdminClient();
  await admin
    .from("leads")
    .update({ atribuido_a: null, atribuido_nome: null, atribuido_em: null })
    .eq("id", leadId);

  await logarEvento({
    leadId,
    organizationId: lead.organization_id,
    tipo: "conversa_liberada",
    descricao: `Conversa liberada por ${ctx.nome}.`,
    autorId: ctx.userId,
    autorNome: ctx.nome,
  });

  revalidatePath("/dashboard/contatos");
  revalidatePath(`/dashboard/contatos/${leadId}`);
  return { ok: true };
}
