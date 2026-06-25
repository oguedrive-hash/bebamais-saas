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
import { diasAquecendo, temperatura, alvoDiario } from "@/lib/caio/aquecimento";

export type PapelAq = "ancora" | "aquecendo";

export interface AqRow {
  id: string;
  instance_name: string;
  numero: string | null;
  apelido: string | null;
  papel: PapelAq;
  estado: string;
  status_conexao: string | null;
  aquecimento_inicio: string;
  alvo_diario: number | null;
  falhas_seguidas: number;
  ativo: boolean;
}

export type AqView = AqRow & {
  conexao: string;
  dias: number;
  temperatura: "frio" | "esquentando" | "quente";
  alvo: number;
  feitoHoje: number;
};

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
  if (profile?.role !== "admin") return "Apenas admin pode gerenciar o aquecedor";
  return null;
}

/** Lista os números do aquecedor + estado de conexão ao vivo + medidor + volume de hoje. */
export async function listarAquecimento(
  orgId: string,
): Promise<{ numeros: AqView[] } | { error: string }> {
  const err = await exigirAdmin();
  if (err) return { error: err };
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("aquecimento_numeros")
    .select(
      "id, instance_name, numero, apelido, papel, estado, status_conexao, aquecimento_inicio, alvo_diario, falhas_seguidas, ativo",
    )
    .eq("organization_id", orgId)
    .order("papel", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) return { error: error.message };

  const inicioDia = new Date();
  inicioDia.setHours(0, 0, 0, 0);

  const rows = (data ?? []) as AqRow[];
  const numeros = await Promise.all(
    rows.map(async (r) => {
      const dias = diasAquecendo(r.aquecimento_inicio);
      const [conexao, feito] = await Promise.all([
        evoConnectionState(r.instance_name),
        admin
          .from("aquecimento_log")
          .select("id", { count: "exact", head: true })
          .or(`de_instance.eq.${r.instance_name},para_instance.eq.${r.instance_name}`)
          .gte("created_at", inicioDia.toISOString())
          .then((res) => res.count ?? 0),
      ]);
      return {
        ...r,
        conexao,
        dias,
        temperatura: temperatura(dias),
        alvo: r.alvo_diario ?? alvoDiario(dias),
        feitoHoje: feito,
      };
    }),
  );
  return { numeros };
}

/** Cria a instância na Evolution + insere a linha no aquecedor. */
export async function adicionarAquecimento(
  orgId: string,
  patch: { papel: PapelAq; numero: string; apelido?: string },
): Promise<{ ok: true; instance_name: string } | { error: string }> {
  const err = await exigirAdmin();
  if (err) return { error: err };
  if (!patch.numero?.trim()) return { error: "Informe o número (telefone)" };

  const instanceName = `aquec_${randomUUID().slice(0, 8)}`;
  const criada = await evoCriarInstancia(instanceName);
  if ("error" in criada) return { error: `Evolution: ${criada.error}` };

  const admin = createAdminClient();
  const { error } = await admin.from("aquecimento_numeros").insert({
    organization_id: orgId,
    instance_name: instanceName,
    numero: patch.numero.replace(/\D/g, ""),
    apelido: patch.apelido?.trim() || null,
    papel: patch.papel,
    estado: "pausado", // entra PAUSADO — só aquece quando clicar Reativar (não dispara sozinho)
    aquecimento_inicio: new Date().toISOString(),
  });
  if (error) {
    await evoDeletarInstancia(instanceName); // desfaz a instância órfã
    return { error: error.message };
  }
  revalidatePath("/admin/aquecimento");
  return { ok: true, instance_name: instanceName };
}

/** Gera o QR (base64) pra conectar o número no WhatsApp. */
export async function gerarQrAquecimento(
  instanceName: string,
): Promise<{ base64?: string; pairingCode?: string | null } | { error: string }> {
  const err = await exigirAdmin();
  if (err) return { error: err };
  return evoQrCode(instanceName);
}

/** Pausa/reativa um número do aquecedor (reativar zera o contador de falhas). */
export async function pausarReativarAquecimento(
  orgId: string,
  id: string,
  ativar: boolean,
): Promise<{ ok: true } | { error: string }> {
  const err = await exigirAdmin();
  if (err) return { error: err };
  const admin = createAdminClient();
  const { error } = await admin
    .from("aquecimento_numeros")
    .update({
      estado: ativar ? "ativo" : "pausado",
      ...(ativar ? { falhas_seguidas: 0 } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("organization_id", orgId);
  if (error) return { error: error.message };
  revalidatePath("/admin/aquecimento");
  return { ok: true };
}

/** Edita papel/apelido de um número do aquecedor. */
export async function atualizarAquecimento(
  orgId: string,
  id: string,
  patch: Partial<Pick<AqRow, "papel" | "apelido" | "alvo_diario">>,
): Promise<{ ok: true } | { error: string }> {
  const err = await exigirAdmin();
  if (err) return { error: err };
  const admin = createAdminClient();
  const { error } = await admin
    .from("aquecimento_numeros")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("organization_id", orgId);
  if (error) return { error: error.message };
  revalidatePath("/admin/aquecimento");
  return { ok: true };
}

/** Remove o número do aquecedor + deleta a instância na Evolution. */
export async function excluirAquecimento(
  orgId: string,
  id: string,
  instanceName: string,
): Promise<{ ok: true } | { error: string }> {
  const err = await exigirAdmin();
  if (err) return { error: err };
  const admin = createAdminClient();
  const { error } = await admin
    .from("aquecimento_numeros")
    .delete()
    .eq("id", id)
    .eq("organization_id", orgId);
  if (error) return { error: error.message };
  await evoDeletarInstancia(instanceName); // best-effort
  revalidatePath("/admin/aquecimento");
  return { ok: true };
}
