"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * CRUD do catálogo de produtos. Padrão do projeto: valida acesso com o client
 * do usuário (org via profiles), escreve via service role.
 */

async function orgDoUsuario(): Promise<{ orgId: string } | { error: string }> {
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
  if (!profile?.organization_id) return { error: "Sem organização vinculada" };
  return { orgId: profile.organization_id as string };
}

function validar(codigoRef: string, descricao: string): string | null {
  if (!codigoRef.trim()) return "Informe o código de referência";
  if (codigoRef.trim().length > 20) return "Código muito longo (máx 20)";
  if (!descricao.trim()) return "Informe a descrição";
  if (descricao.trim().length > 200) return "Descrição muito longa (máx 200)";
  return null;
}

export async function criarProduto(input: {
  codigoRef: string;
  descricao: string;
}): Promise<{ ok: true } | { error: string }> {
  const ctx = await orgDoUsuario();
  if ("error" in ctx) return ctx;
  const invalido = validar(input.codigoRef, input.descricao);
  if (invalido) return { error: invalido };

  const admin = createAdminClient();
  const { error } = await admin.from("produtos").insert({
    organization_id: ctx.orgId,
    codigo_ref: input.codigoRef.trim().toUpperCase(),
    descricao: input.descricao.trim(),
  });
  if (error) {
    if (error.code === "23505") {
      // Pode ser um produto REMOVIDO (ativo=false) com o mesmo código — reativa.
      const { data: reativado, error: errReativa } = await admin
        .from("produtos")
        .update({
          ativo: true,
          disponivel: true,
          descricao: input.descricao.trim(),
        })
        .eq("organization_id", ctx.orgId)
        .eq("codigo_ref", input.codigoRef.trim().toUpperCase())
        .eq("ativo", false)
        .select("id")
        .maybeSingle();
      if (errReativa) return { error: errReativa.message };
      if (reativado) {
        revalidatePath("/dashboard/produtos");
        return { ok: true };
      }
      return { error: `Já existe um produto com o código ${input.codigoRef.trim().toUpperCase()}` };
    }
    return { error: error.message };
  }
  revalidatePath("/dashboard/produtos");
  return { ok: true };
}

export async function atualizarProduto(
  id: string,
  input: { codigoRef: string; descricao: string },
): Promise<{ ok: true } | { error: string }> {
  const ctx = await orgDoUsuario();
  if ("error" in ctx) return ctx;
  const invalido = validar(input.codigoRef, input.descricao);
  if (invalido) return { error: invalido };

  const admin = createAdminClient();
  const { data: linha, error } = await admin
    .from("produtos")
    .update({
      codigo_ref: input.codigoRef.trim().toUpperCase(),
      descricao: input.descricao.trim(),
    })
    .eq("id", id)
    .eq("organization_id", ctx.orgId)
    .eq("ativo", true) // não edita produto já removido por outro atendente
    .select("id")
    .maybeSingle();
  if (error) {
    if (error.code === "23505")
      return { error: `Já existe um produto com o código ${input.codigoRef.trim().toUpperCase()}` };
    return { error: error.message };
  }
  if (!linha) return { error: "Produto não encontrado" };
  revalidatePath("/dashboard/produtos");
  return { ok: true };
}

export async function setDisponivel(
  id: string,
  disponivel: boolean,
): Promise<{ ok: true } | { error: string }> {
  const ctx = await orgDoUsuario();
  if ("error" in ctx) return ctx;
  const admin = createAdminClient();
  const { data: linha, error } = await admin
    .from("produtos")
    .update({ disponivel })
    .eq("id", id)
    .eq("organization_id", ctx.orgId)
    .eq("ativo", true) // não alterna produto já removido
    .select("id")
    .maybeSingle();
  if (error) return { error: error.message };
  if (!linha) return { error: "Produto não encontrado" };
  revalidatePath("/dashboard/produtos");
  return { ok: true };
}

export async function removerProduto(
  id: string,
): Promise<{ ok: true } | { error: string }> {
  const ctx = await orgDoUsuario();
  if ("error" in ctx) return ctx;
  const admin = createAdminClient();
  // Soft delete: sai do catálogo mas fica no banco (histórico/reativação)
  const { data: linha, error } = await admin
    .from("produtos")
    .update({ ativo: false })
    .eq("id", id)
    .eq("organization_id", ctx.orgId)
    .select("id")
    .maybeSingle();
  if (error) return { error: error.message };
  if (!linha) return { error: "Produto não encontrado" };
  revalidatePath("/dashboard/produtos");
  return { ok: true };
}
