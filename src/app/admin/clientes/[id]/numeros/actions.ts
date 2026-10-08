"use server";

import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { evoConnectionState } from "@/lib/caio/evolution-api";
import {
  evoConfigurarWebhook,
  evoCriarInstancia,
  evoDeletarInstancia,
  evoQrCode,
} from "@/lib/caio/evolution-admin";

export interface NumeroRow {
  id: string;
  instance_name: string;
  numero: string | null;
  apelido: string | null;
  persona_nome: string | null;
  ativo: boolean;
  ia_ativa: boolean;
  numeros_teste: string | null;
}

async function exigirAdmin(): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return "Não autenticado";
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "admin") return "Apenas administradores podem gerenciar números";
  return null;
}

export async function listarNumeros(
  orgId: string,
): Promise<{ numeros: (NumeroRow & { conexao: string })[] } | { error: string }> {
  const err = await exigirAdmin();
  if (err) return { error: err };
  const { data, error } = await createAdminClient()
    .from("org_numeros")
    .select("id, instance_name, numero, apelido, persona_nome, ativo, ia_ativa, numeros_teste")
    .eq("organization_id", orgId)
    .order("created_at", { ascending: true });
  if (error) return { error: error.message };
  const numeros = await Promise.all(
    ((data ?? []) as NumeroRow[]).map(async (r) => ({ ...r, conexao: await evoConnectionState(r.instance_name) })),
  );
  return { numeros };
}

/** Cria a conexão na Evolution e cadastra o número. Depois é só ler o QR Code. */
export async function adicionarNumero(
  orgId: string,
  dados: { numero: string; apelido: string; nomeAssistente?: string },
): Promise<{ ok: true; instance_name: string } | { error: string }> {
  const err = await exigirAdmin();
  if (err) return { error: err };
  const numero = dados.numero.replace(/\D/g, "");
  if (numero.length < 10) return { error: "Informe o telefone com DDD." };
  if (!dados.apelido.trim()) return { error: "Dê um nome curto para o número (ex.: Loja, Vendas)." };

  const instanceName = `atendimento_${randomUUID().slice(0, 8)}`;
  const criada = await evoCriarInstancia(instanceName);
  if ("error" in criada) return { error: `Não foi possível criar a conexão: ${criada.error}` };

  const { error } = await createAdminClient().from("org_numeros").insert({
    organization_id: orgId,
    instance_name: instanceName,
    numero,
    apelido: dados.apelido.trim(),
    persona_nome: dados.nomeAssistente?.trim() || null,
    papel: "atendimento",
    estado: "ativo",
  });
  if (error) {
    await evoDeletarInstancia(instanceName);
    return { error: error.message };
  }
  revalidatePath(`/admin/clientes/${orgId}/numeros`);
  return { ok: true, instance_name: instanceName };
}

export async function gerarQrNumero(
  instanceName: string,
): Promise<{ base64?: string; pairingCode?: string | null } | { error: string }> {
  const err = await exigirAdmin();
  if (err) return { error: err };
  // Garante o webhook com o token atual antes de conectar.
  await evoConfigurarWebhook(instanceName);
  return evoQrCode(instanceName);
}

export async function estadoConexao(instanceName: string): Promise<string> {
  if (await exigirAdmin()) return "unknown";
  return evoConnectionState(instanceName);
}

/** Reaplica a configuração do webhook (necessário depois de trocar o WEBHOOK_SECRET). */
export async function reconfigurarConexao(instanceName: string): Promise<{ ok: true } | { error: string }> {
  const err = await exigirAdmin();
  if (err) return { error: err };
  return evoConfigurarWebhook(instanceName);
}

export async function atualizarNumero(
  orgId: string,
  id: string,
  patch: Partial<Pick<NumeroRow, "apelido" | "persona_nome" | "ia_ativa" | "numeros_teste" | "ativo">>,
): Promise<{ ok: true } | { error: string }> {
  const err = await exigirAdmin();
  if (err) return { error: err };
  const { error } = await createAdminClient()
    .from("org_numeros")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("organization_id", orgId);
  if (error) return { error: error.message };
  revalidatePath(`/admin/clientes/${orgId}/numeros`);
  return { ok: true };
}

export async function excluirNumero(
  orgId: string,
  id: string,
  instanceName: string,
): Promise<{ ok: true } | { error: string }> {
  const err = await exigirAdmin();
  if (err) return { error: err };
  const { error } = await createAdminClient().from("org_numeros").delete().eq("id", id).eq("organization_id", orgId);
  if (error) return { error: error.message };
  await evoDeletarInstancia(instanceName);
  revalidatePath(`/admin/clientes/${orgId}/numeros`);
  return { ok: true };
}
