"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type CaioConfigPatch = {
  comportamentoInbound?: string;
  comportamentoProspeccao?: string;
  baseConhecimento?: string;
};

export async function salvarCaioConfig(
  organizationId: string,
  patch: CaioConfigPatch,
): Promise<{ ok: true } | { error: string }> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Não autenticado" };

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (profile?.role !== "admin") {
    return { error: "Apenas admin pode editar o atendente IA" };
  }

  // Le valores atuais pra preservar campos nao enviados
  const { data: atual } = await supabase
    .from("organizations")
    .select("prompt_system, prompt_system_prospeccao, base_conhecimento")
    .eq("id", organizationId)
    .single();

  const comportamentoInbound =
    patch.comportamentoInbound ?? atual?.prompt_system ?? "";
  const comportamentoProspeccao =
    patch.comportamentoProspeccao ?? atual?.prompt_system_prospeccao ?? "";
  const baseConhecimento =
    patch.baseConhecimento ?? atual?.base_conhecimento ?? "";

  const { error } = await supabase
    .from("organizations")
    .update({
      prompt_system: comportamentoInbound.trim() || null,
      prompt_system_prospeccao: comportamentoProspeccao.trim() || null,
      base_conhecimento: baseConhecimento.trim() || null,
    })
    .eq("id", organizationId);

  if (error) return { error: error.message };

  revalidatePath(`/admin/clientes/${organizationId}/caio`, "layout");
  revalidatePath(`/admin/clientes/${organizationId}`);
  return { ok: true };
}
