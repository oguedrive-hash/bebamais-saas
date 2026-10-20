"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { evoCriarInstanciaAprendizado, evoDeletarInstancia, evoQrCode } from "@/lib/caio/evolution-admin";
import { evoConnectionState } from "@/lib/caio/evolution-api";
import { PREFIXO_INSTANCIA, importarHistorico } from "@/lib/aprendizado/captura";

/** Só administrador mexe no aprendizado: são conversas reais de clientes. */
async function exigirAdmin(organizationId: string): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return "Sua sessão expirou. Entre de novo.";
  const { data: perfil } = await supabase
    .from("profiles")
    .select("role, organization_id")
    .eq("id", user.id)
    .single();
  if (perfil?.role !== "admin") return "Só o administrador pode mexer no aprendizado.";
  if (perfil.organization_id && perfil.organization_id !== organizationId) return "Loja não encontrada.";
  return null;
}

function caminho(organizationId: string) {
  return `/admin/clientes/${organizationId}/aprendizado`;
}

async function configAtual(organizationId: string) {
  const { data } = await createAdminClient()
    .from("aprendizado_config")
    .select("instance_name, status_conexao")
    .eq("organization_id", organizationId)
    .maybeSingle();
  return data;
}

/** Cria (se preciso) a conexão só de leitura e devolve o QR Code para ler no celular da loja. */
export async function conectarAprendizado(
  organizationId: string,
): Promise<{ qr: string | null; codigo: string | null } | { error: string }> {
  const negado = await exigirAdmin(organizationId);
  if (negado) return { error: negado };

  let cfg = await configAtual(organizationId);
  if (!cfg) {
    const instance = `${PREFIXO_INSTANCIA}${crypto.randomUUID().slice(0, 8)}`;
    const { error } = await createAdminClient()
      .from("aprendizado_config")
      .insert({ organization_id: organizationId, instance_name: instance, status_conexao: "connecting" });
    if (error) return { error: error.message };
    cfg = { instance_name: instance, status_conexao: "connecting" };
  }
  const criado = await evoCriarInstanciaAprendizado(cfg.instance_name);
  if ("error" in criado) return { error: `Não foi possível criar a conexão: ${criado.error}` };
  const qr = await evoQrCode(cfg.instance_name);
  if ("error" in qr) return { error: `Não foi possível gerar o QR Code: ${qr.error}` };
  return { qr: qr.base64 ?? null, codigo: qr.pairingCode ?? null };
}

/** Situação da conexão (a tela pergunta enquanto o QR Code está aberto). */
export async function situacaoAprendizado(
  organizationId: string,
): Promise<{ estado: string } | { error: string }> {
  const negado = await exigirAdmin(organizationId);
  if (negado) return { error: negado };
  const cfg = await configAtual(organizationId);
  if (!cfg) return { estado: "sem_conexao" };
  const estado = await evoConnectionState(cfg.instance_name);
  if (estado === "unknown") return { estado };
  const upd: Record<string, unknown> = { status_conexao: estado, updated_at: new Date().toISOString() };
  if (estado === "open" && cfg.status_conexao !== "open") upd.conectado_em = new Date().toISOString();
  await createAdminClient().from("aprendizado_config").update(upd).eq("organization_id", organizationId);
  if (estado === "open" && cfg.status_conexao !== "open") revalidatePath(caminho(organizationId));
  return { estado };
}

/** Copia para o painel o que a Evolution guardou (inclui o histórico trazido na conexão). */
export async function importarHistoricoAprendizado(
  organizationId: string,
): Promise<{ importadas: number; lidas: number } | { error: string }> {
  const negado = await exigirAdmin(organizationId);
  if (negado) return { error: negado };
  const cfg = await configAtual(organizationId);
  if (!cfg) return { error: "Conecte o WhatsApp da loja primeiro." };
  const r = await importarHistorico(organizationId, cfg.instance_name);
  revalidatePath(caminho(organizationId));
  return r;
}

/** Desconecta o WhatsApp da loja. O que JÁ foi captado continua aqui; só param de chegar conversas novas. */
export async function desconectarAprendizado(organizationId: string): Promise<{ ok: true } | { error: string }> {
  const negado = await exigirAdmin(organizationId);
  if (negado) return { error: negado };
  const cfg = await configAtual(organizationId);
  if (cfg) {
    // A Evolution apaga as mensagens junto com a conexão: antes, copia o que ainda
    // não foi importado, para não perder o histórico.
    await importarHistorico(organizationId, cfg.instance_name);
    const r = await evoDeletarInstancia(cfg.instance_name);
    if ("error" in r) return r;
    await createAdminClient().from("aprendizado_config").delete().eq("organization_id", organizationId);
  }
  revalidatePath(caminho(organizationId));
  return { ok: true };
}

/** Apaga TUDO que foi captado (não desconecta). */
export async function apagarCapturaAprendizado(organizationId: string): Promise<{ ok: true } | { error: string }> {
  const negado = await exigirAdmin(organizationId);
  if (negado) return { error: negado };
  const { error } = await createAdminClient().from("aprendizado_mensagens").delete().eq("organization_id", organizationId);
  if (error) return { error: error.message };
  revalidatePath(caminho(organizationId));
  return { ok: true };
}

/** Para de captar um contato (conversa pessoal, fornecedor) e apaga o que já veio dele. */
export async function excluirContatoAprendizado(
  organizationId: string,
  conversaJid: string,
): Promise<{ ok: true } | { error: string }> {
  const negado = await exigirAdmin(organizationId);
  if (negado) return { error: negado };
  const admin = createAdminClient();
  await admin
    .from("aprendizado_excluidos")
    .upsert({ organization_id: organizationId, conversa_jid: conversaJid }, { onConflict: "organization_id,conversa_jid" });
  const { error } = await admin
    .from("aprendizado_mensagens")
    .delete()
    .eq("organization_id", organizationId)
    .eq("conversa_jid", conversaJid);
  if (error) return { error: error.message };
  revalidatePath(caminho(organizationId));
  return { ok: true };
}
