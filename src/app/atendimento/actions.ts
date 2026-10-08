"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { usuarioAtual, type UsuarioPainel } from "@/lib/atendimento/painel";
import { enviarArquivo, enviarTexto } from "@/lib/atendimento/whatsapp";
import { TAMANHO_MAX_BYTES } from "@/lib/atendimento/arquivos";

type Resultado = { ok: true } | { error: string };

interface ClienteAtual {
  id: string;
  organization_id: string;
  atend_status: string;
  atribuido_a: string | null;
  atribuido_nome: string | null;
}

/** Confere login e se o cliente é da mesma empresa (a regra de acesso do banco filtra). */
async function contexto(leadId: string): Promise<{ usuario: UsuarioPainel; cliente: ClienteAtual } | { error: string }> {
  const usuario = await usuarioAtual();
  if (!usuario) return { error: "Sua sessão expirou. Entre de novo." };
  const supabase = await createClient();
  const { data } = await supabase
    .from("leads")
    .select("id, organization_id, atend_status, atribuido_a, atribuido_nome")
    .eq("id", leadId)
    .maybeSingle();
  if (!data) return { error: "Cliente não encontrado." };
  return { usuario, cliente: data as ClienteAtual };
}

const ehMeu = (c: ClienteAtual, u: UsuarioPainel) => c.atend_status === "atendendo" && c.atribuido_a === u.id;

/** Pega o cliente para si. `forcar` assume mesmo se estiver com outra atendente. */
export async function pegarCliente(leadId: string, forcar = false): Promise<Resultado> {
  const ctx = await contexto(leadId);
  if ("error" in ctx) return ctx;
  const { usuario, cliente } = ctx;
  if (ehMeu(cliente, usuario)) return { ok: true };
  const comOutra = cliente.atend_status === "atendendo" && cliente.atribuido_a && cliente.atribuido_a !== usuario.id;
  if (comOutra && !forcar) {
    return { error: `Este cliente está com ${cliente.atribuido_nome ?? "outra atendente"}.` };
  }
  const admin = createAdminClient();
  let q = admin
    .from("leads")
    .update({
      atend_status: "atendendo",
      atribuido_a: usuario.id,
      atribuido_nome: usuario.nome,
      atribuido_em: new Date().toISOString(),
      caio_responder_em: null,
      finalizado_em: null,
    })
    .eq("id", leadId);
  // Se duas atendentes clicarem juntas, só a primeira leva.
  if (!forcar) q = q.or(`atribuido_a.is.null,atend_status.neq.atendendo`);
  const { data } = await q.select("id").maybeSingle();
  if (!data) return { error: "Outra atendente acabou de pegar este cliente." };
  revalidatePath("/atendimento");
  return { ok: true };
}

export async function enviarMensagemAction(leadId: string, texto: string): Promise<Resultado> {
  const ctx = await contexto(leadId);
  if ("error" in ctx) return ctx;
  if (!ehMeu(ctx.cliente, ctx.usuario)) return { error: "Pegue o cliente antes de responder." };
  const r = await enviarTexto({ leadId, texto, autor: "atendente", remetenteNome: ctx.usuario.nome });
  revalidatePath("/atendimento");
  return "error" in r ? { error: `Não foi enviada: ${r.error}` } : { ok: true };
}

export async function enviarArquivoAction(formData: FormData): Promise<Resultado> {
  const leadId = String(formData.get("leadId") ?? "");
  const arquivo = formData.get("arquivo");
  const legenda = String(formData.get("legenda") ?? "");
  if (!(arquivo instanceof File) || arquivo.size === 0) return { error: "Escolha uma foto ou arquivo." };
  if (arquivo.size > TAMANHO_MAX_BYTES) return { error: "Arquivo grande demais (máximo 15 MB)." };
  const ctx = await contexto(leadId);
  if ("error" in ctx) return ctx;
  if (!ehMeu(ctx.cliente, ctx.usuario)) return { error: "Pegue o cliente antes de responder." };
  const r = await enviarArquivo({
    leadId,
    conteudo: Buffer.from(await arquivo.arrayBuffer()),
    mime: arquivo.type || "application/octet-stream",
    nome: arquivo.name || "arquivo",
    legenda,
    autor: "atendente",
    remetenteNome: ctx.usuario.nome,
  });
  revalidatePath("/atendimento");
  return "error" in r ? { error: `Não foi enviado: ${r.error}` } : { ok: true };
}

/** Passa o cliente para outra atendente, ou devolve para a fila ("qualquer uma"). */
export async function passarCliente(leadId: string, paraId: string | null): Promise<Resultado> {
  const ctx = await contexto(leadId);
  if ("error" in ctx) return ctx;
  const { usuario, cliente } = ctx;
  if (!ehMeu(cliente, usuario) && usuario.role !== "admin") return { error: "Só quem está atendendo pode passar o cliente." };
  const admin = createAdminClient();
  if (!paraId) {
    await admin
      .from("leads")
      .update({
        atend_status: "aguardando",
        atribuido_a: null,
        atribuido_nome: null,
        aguardando_desde: new Date().toISOString(),
        avisos_espera: 99, // o cliente já foi atendido; não manda mensagem de espera
      })
      .eq("id", leadId);
  } else {
    const { data: destino } = await admin
      .from("profiles")
      .select("id, nome, organization_id")
      .eq("id", paraId)
      .maybeSingle();
    if (!destino || destino.organization_id !== cliente.organization_id) return { error: "Atendente não encontrada." };
    await admin
      .from("leads")
      .update({
        atend_status: "atendendo",
        atribuido_a: destino.id,
        atribuido_nome: destino.nome?.trim() || "Atendente",
        atribuido_em: new Date().toISOString(),
      })
      .eq("id", leadId);
  }
  revalidatePath("/atendimento");
  return { ok: true };
}

export async function finalizarAtendimento(leadId: string): Promise<Resultado> {
  const ctx = await contexto(leadId);
  if ("error" in ctx) return ctx;
  const { usuario, cliente } = ctx;
  if (!ehMeu(cliente, usuario) && usuario.role !== "admin") return { error: "Só quem está atendendo pode finalizar." };
  await createAdminClient()
    .from("leads")
    .update({ atend_status: "finalizado", finalizado_em: new Date().toISOString(), caio_responder_em: null })
    .eq("id", leadId);
  revalidatePath("/atendimento");
  return { ok: true };
}
