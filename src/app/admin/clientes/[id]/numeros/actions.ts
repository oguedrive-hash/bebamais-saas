"use server";

import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { evoConnectionState } from "@/lib/caio/evolution-api";
import {
  evoCriarInstancia,
  evoQrCode,
  evoDeletarInstancia,
} from "@/lib/caio/evolution-admin";

export type PapelNumero = "atendimento" | "prospeccao" | "backup";

export interface NumeroRow {
  id: string;
  instance_name: string;
  numero: string | null;
  papel: PapelNumero;
  persona_nome: string | null;
  persona_voice_id: string | null;
  prioridade: number;
  estado: string;
  status_conexao: string | null;
  ativo: boolean;
}

/** Garante que o usuário é admin. Retorna null se ok, ou string de erro. */
async function exigirAdmin(): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return "Não autenticado";
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (profile?.role !== "admin") return "Apenas admin pode gerenciar números";
  return null;
}

/** Lista os números do pool + consulta o estado de conexão ao vivo de cada um. */
export async function listarNumeros(
  orgId: string,
): Promise<{ numeros: (NumeroRow & { conexao: string })[] } | { error: string }> {
  const err = await exigirAdmin();
  if (err) return { error: err };
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("org_numeros")
    .select(
      "id, instance_name, numero, papel, persona_nome, persona_voice_id, prioridade, estado, status_conexao, ativo",
    )
    .eq("organization_id", orgId)
    .order("papel", { ascending: true })
    .order("prioridade", { ascending: true });
  if (error) return { error: error.message };
  const rows = (data ?? []) as NumeroRow[];
  const numeros = await Promise.all(
    rows.map(async (r) => ({
      ...r,
      conexao: await evoConnectionState(r.instance_name),
    })),
  );
  return { numeros };
}

/** Cria a instância na Evolution + insere a linha no pool. */
export async function adicionarNumero(
  orgId: string,
  patch: {
    papel: PapelNumero;
    numero: string;
    persona_nome: string;
    persona_voice_id?: string;
    prioridade?: number;
  },
): Promise<{ ok: true; instance_name: string } | { error: string }> {
  const err = await exigirAdmin();
  if (err) return { error: err };
  if (!patch.numero?.trim()) return { error: "Informe o número (telefone)" };
  if (!patch.persona_nome?.trim()) return { error: "Informe a persona (nome)" };

  const instanceName = `${patch.papel}_${randomUUID().slice(0, 8)}`;
  const criada = await evoCriarInstancia(instanceName);
  if ("error" in criada) return { error: `Evolution: ${criada.error}` };

  const admin = createAdminClient();
  const { error } = await admin.from("org_numeros").insert({
    organization_id: orgId,
    instance_name: instanceName,
    numero: patch.numero.replace(/\D/g, ""),
    papel: patch.papel,
    persona_nome: patch.persona_nome.trim(),
    persona_voice_id: patch.persona_voice_id?.trim() || null,
    prioridade: patch.prioridade ?? 0,
    estado: patch.papel === "backup" ? "standby" : "ativo",
  });
  if (error) {
    await evoDeletarInstancia(instanceName); // desfaz a instância órfã
    return { error: error.message };
  }
  revalidatePath(`/admin/clientes/${orgId}/numeros`);
  return { ok: true, instance_name: instanceName };
}

/** Gera o QR (base64) pra conectar o número no WhatsApp. */
export async function gerarQrNumero(
  instanceName: string,
): Promise<{ base64?: string; pairingCode?: string | null } | { error: string }> {
  const err = await exigirAdmin();
  if (err) return { error: err };
  return evoQrCode(instanceName);
}

/** Edita papel/persona/voz/prioridade/estado/ativo de um número. */
export async function atualizarNumero(
  orgId: string,
  id: string,
  patch: Partial<
    Pick<
      NumeroRow,
      "papel" | "persona_nome" | "persona_voice_id" | "prioridade" | "estado" | "ativo"
    >
  >,
): Promise<{ ok: true } | { error: string }> {
  const err = await exigirAdmin();
  if (err) return { error: err };
  // Estado acompanha o papel: atendimento/prospecção ficam ATIVOS; backup vira
  // standby. (Só deriva quando o papel mudou e o estado não foi passado à mão.)
  // É o que permite ter N atendimentos — cada um atende quem mandar msg pra ele.
  const update: Record<string, unknown> = { ...patch, updated_at: new Date().toISOString() };
  if (patch.papel && patch.estado === undefined) {
    update.estado = patch.papel === "backup" ? "standby" : "ativo";
  }
  const admin = createAdminClient();
  const { error } = await admin
    .from("org_numeros")
    .update(update)
    .eq("id", id)
    .eq("organization_id", orgId);
  if (error) return { error: error.message };
  revalidatePath(`/admin/clientes/${orgId}/numeros`);
  return { ok: true };
}

/** Remove o número do pool + deleta a instância na Evolution. */
export async function excluirNumero(
  orgId: string,
  id: string,
  instanceName: string,
): Promise<{ ok: true } | { error: string }> {
  const err = await exigirAdmin();
  if (err) return { error: err };
  const admin = createAdminClient();
  const { error } = await admin
    .from("org_numeros")
    .delete()
    .eq("id", id)
    .eq("organization_id", orgId);
  if (error) return { error: error.message };
  await evoDeletarInstancia(instanceName); // best-effort
  revalidatePath(`/admin/clientes/${orgId}/numeros`);
  return { ok: true };
}
