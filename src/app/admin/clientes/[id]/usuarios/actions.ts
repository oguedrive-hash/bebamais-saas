"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  usuarioParaEmail,
  normalizarUsuario,
  usuarioValido,
} from "@/lib/usuarios";

/**
 * Gestão de usuários do painel (Admin → Usuários).
 * Login é por USUÁRIO/senha — o e-mail sintético (@usuarios.bebamais.local)
 * é detalhe interno do Supabase Auth, invisível pra equipe.
 * Toda action revalida que o CHAMADOR é admin antes de usar o service role.
 */

async function exigirAdmin(): Promise<
  { userId: string; orgId: string | null } | { error: string }
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Não autenticado" };
  const { data: profile } = await supabase
    .from("profiles")
    .select("role, organization_id")
    .eq("id", user.id)
    .single();
  if (profile?.role !== "admin") return { error: "Apenas administradores" };
  return { userId: user.id, orgId: profile.organization_id ?? null };
}

/** Admin de org só opera na PRÓPRIA org (admin global, sem org, opera em qualquer). */
function orgPermitida(
  ctx: { orgId: string | null },
  organizationId: string,
): boolean {
  return ctx.orgId === null || ctx.orgId === organizationId;
}

export async function criarUsuario(input: {
  nome: string;
  usuario: string;
  senha: string;
  role: "client" | "admin";
  organizationId: string;
}): Promise<{ ok: true; usuario: string } | { error: string }> {
  const ctx = await exigirAdmin();
  if ("error" in ctx) return ctx;
  if (!orgPermitida(ctx, input.organizationId)) {
    return { error: "Sem permissão pra essa organização" };
  }

  const nome = input.nome.trim();
  if (!nome) return { error: "Informe o nome" };
  const usuario = normalizarUsuario(input.usuario);
  if (!usuarioValido(usuario)) {
    return {
      error:
        "Usuário inválido — use 2 a 30 caracteres: letras minúsculas, números, ponto, hífen (ex: maria.silva)",
    };
  }
  if (input.senha.length < 8) {
    return { error: "Senha muito curta (mínimo 8 caracteres)" };
  }
  const role = input.role === "admin" ? "admin" : "client";
  const email = usuarioParaEmail(usuario)!;

  const admin = createAdminClient();
  const { data: criado, error } = await admin.auth.admin.createUser({
    email,
    password: input.senha,
    email_confirm: true, // e-mail sintético — nunca haverá verificação
    user_metadata: { nome, usuario },
  });
  if (error) {
    if (/already.*registered|already.*exists/i.test(error.message)) {
      return { error: `O usuário "${usuario}" já existe` };
    }
    return { error: error.message };
  }

  // O trigger on_auth_user_created cria o profile (role client, sem org) —
  // completa com org + role + nome limpo.
  const { error: profErr } = await admin
    .from("profiles")
    .update({ nome, role, organization_id: input.organizationId })
    .eq("id", criado.user.id);
  if (profErr) return { error: `Usuário criado, mas o perfil falhou: ${profErr.message}` };

  revalidatePath(`/admin/clientes/${input.organizationId}/usuarios`);
  return { ok: true, usuario };
}

/** O alvo precisa existir e pertencer a uma org que o chamador pode operar. */
async function validarAlvo(
  ctx: { userId: string; orgId: string | null },
  targetUserId: string,
): Promise<{ ok: true } | { error: string }> {
  const admin = createAdminClient();
  const { data: alvo } = await admin
    .from("profiles")
    .select("organization_id")
    .eq("id", targetUserId)
    .maybeSingle();
  if (!alvo) return { error: "Usuário não encontrado" };
  if (ctx.orgId !== null && alvo.organization_id !== ctx.orgId) {
    return { error: "Sem permissão pra esse usuário" };
  }
  return { ok: true };
}

export async function resetarSenha(input: {
  userId: string;
  novaSenha: string;
}): Promise<{ ok: true } | { error: string }> {
  const ctx = await exigirAdmin();
  if ("error" in ctx) return ctx;
  const alvo = await validarAlvo(ctx, input.userId);
  if ("error" in alvo) return alvo;
  if (input.novaSenha.length < 8) {
    return { error: "Senha muito curta (mínimo 8 caracteres)" };
  }
  const admin = createAdminClient();
  const { error } = await admin.auth.admin.updateUserById(input.userId, {
    password: input.novaSenha,
  });
  if (error) return { error: error.message };
  return { ok: true };
}

export async function removerUsuario(input: {
  userId: string;
  organizationId: string;
}): Promise<{ ok: true } | { error: string }> {
  const ctx = await exigirAdmin();
  if ("error" in ctx) return ctx;
  if (input.userId === ctx.userId) {
    return { error: "Você não pode remover o próprio usuário" };
  }
  const alvo = await validarAlvo(ctx, input.userId);
  if ("error" in alvo) return alvo;
  const admin = createAdminClient();
  // deleteUser derruba auth.users; profiles cai junto (FK on delete cascade)
  const { error } = await admin.auth.admin.deleteUser(input.userId);
  if (error) return { error: error.message };
  revalidatePath(`/admin/clientes/${input.organizationId}/usuarios`);
  return { ok: true };
}
