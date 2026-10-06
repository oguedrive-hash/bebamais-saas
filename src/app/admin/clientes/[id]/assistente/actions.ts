"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalizarConfig, type AtendimentoConfig } from "@/lib/atendimento/regras";

export async function salvarAssistente(
  orgId: string,
  dados: { informacoes: string; config: AtendimentoConfig; respostasRapidas: string[] },
): Promise<{ ok: true } | { error: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Não autenticado" };
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "admin") return { error: "Apenas administradores podem alterar o assistente" };

  const config = normalizarConfig(dados.config);
  const respostas = dados.respostasRapidas.map((r) => r.trim()).filter(Boolean).slice(0, 12);
  const { error } = await createAdminClient()
    .from("organizations")
    .update({
      base_conhecimento: dados.informacoes.trim().slice(0, 6000),
      atendimento_config: config,
      respostas_rapidas: respostas,
    })
    .eq("id", orgId);
  if (error) return { error: error.message };
  revalidatePath(`/admin/clientes/${orgId}/assistente`);
  return { ok: true };
}
