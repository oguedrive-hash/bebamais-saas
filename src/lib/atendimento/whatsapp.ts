/**
 * Envio de mensagens ao cliente (texto e arquivos) pelo número em que ELE
 * escreveu, e registro no histórico do painel.
 *
 * Reaproveita do código antigo: o envio pela Evolution e a tentativa em mais de
 * um destino (@lid e número puro), que resolve o problema do WhatsApp com
 * contatos migrados para LID.
 */
import { createAdminClient } from "@/lib/supabase/admin";
import {
  aguardarAceite,
  evoSendMedia,
  evoSendPresence,
  evoSendText,
  resolverLidPorNumero,
} from "@/lib/caio/evolution-api";
import { INSTANCE_NAME } from "@/lib/caio/config";
import { salvarArquivo, tipoPorMime } from "./arquivos";

type Autor = "assistente" | "atendente" | "sistema";

/** IDs de mensagens que o PRÓPRIO sistema mandou (para não confundir com resposta pelo celular). */
const enviadosRecentemente = new Map<string, number>();
export function registrarEnvioDoSistema(id: string) {
  enviadosRecentemente.set(id, Date.now());
  if (enviadosRecentemente.size > 1000) {
    const limite = Date.now() - 10 * 60_000;
    for (const [k, t] of enviadosRecentemente) if (t < limite) enviadosRecentemente.delete(k);
  }
}
export function foiEnviadoPeloSistema(id: string): boolean {
  return enviadosRecentemente.has(id);
}

interface Rota {
  leadId: string;
  orgId: string;
  instance: string;
  destinos: string[];
  whatsappJid: string | null;
}

async function rotaDoLead(leadId: string): Promise<Rota | { error: string }> {
  const admin = createAdminClient();
  const { data: lead } = await admin
    .from("leads")
    .select("id, organization_id, telefone, evolution_instance, whatsapp_jid")
    .eq("id", leadId)
    .maybeSingle();
  if (!lead) return { error: "Cliente não encontrado" };

  // Responde pelo número em que o cliente escreveu por último. Se esse número
  // não existir mais, usa o primeiro número ativo da empresa.
  let instance: string | null = lead.evolution_instance ?? null;
  if (instance) {
    const { data: num } = await admin
      .from("org_numeros")
      .select("instance_name")
      .eq("instance_name", instance)
      .eq("ativo", true)
      .maybeSingle();
    if (!num) instance = null;
  }
  if (!instance) {
    const { data: nums } = await admin
      .from("org_numeros")
      .select("instance_name")
      .eq("organization_id", lead.organization_id)
      .eq("ativo", true)
      .order("prioridade", { ascending: true })
      .limit(1);
    instance = nums?.[0]?.instance_name ?? (INSTANCE_NAME || null);
  }
  if (!instance) return { error: "Nenhum número de WhatsApp conectado" };

  const numero = String(lead.telefone ?? "").replace(/\D/g, "");
  let lid = lead.whatsapp_jid?.includes("@lid") ? lead.whatsapp_jid : null;
  if (!lid && numero) lid = await resolverLidPorNumero(instance, numero);
  const preferido = lead.whatsapp_jid || lid || numero;
  const destinos = [...new Set([preferido, lid, numero].filter(Boolean) as string[])];
  if (!destinos.length) return { error: "Cliente sem telefone" };
  return { leadId, orgId: lead.organization_id, instance, destinos, whatsappJid: lead.whatsapp_jid ?? null };
}

/** Tenta cada destino até o WhatsApp aceitar; aprende qual funcionou. */
async function enviarComDestinos(
  rota: Rota,
  enviarUm: (dest: string) => Promise<{ id: string } | { error: string }>,
): Promise<{ msgId: string } | { error: string }> {
  let ultimoErro = "não foi possível enviar";
  for (const dest of rota.destinos) {
    const env = await enviarUm(dest);
    if ("error" in env) {
      ultimoErro = env.error;
      continue;
    }
    registrarEnvioDoSistema(env.id);
    if (await aguardarAceite(rota.instance, env.id)) {
      if (dest !== rota.whatsappJid) {
        await createAdminClient().from("leads").update({ whatsapp_jid: dest }).eq("id", rota.leadId);
      }
      return { msgId: env.id };
    }
    ultimoErro = "o WhatsApp recusou a mensagem";
  }
  return { error: ultimoErro };
}

async function registrar(opts: {
  rota: Rota;
  autor: Autor;
  remetenteNome: string;
  tipo: string;
  conteudo: string | null;
  msgId: string | null;
  falhou: boolean;
  arquivoPath?: string | null;
  arquivoNome?: string | null;
  arquivoMime?: string | null;
}) {
  await createAdminClient().from("mensagens").insert({
    organization_id: opts.rota.orgId,
    lead_id: opts.rota.leadId,
    direcao: "saida",
    autor: opts.autor,
    remetente_nome: opts.remetenteNome,
    tipo: opts.tipo,
    conteudo: opts.conteudo,
    whatsapp_msg_id: opts.msgId,
    falha_envio: opts.falhou,
    arquivo_path: opts.arquivoPath ?? null,
    arquivo_nome: opts.arquivoNome ?? null,
    arquivo_mime: opts.arquivoMime ?? null,
  });
}

/** Mostra "digitando..." para o cliente (não bloqueia se falhar). */
export async function mostrarDigitando(leadId: string, ms: number): Promise<void> {
  const rota = await rotaDoLead(leadId);
  if ("error" in rota) return;
  void evoSendPresence({ instance: rota.instance, telefone: rota.destinos[0], presence: "composing", delayMs: ms });
}

export async function enviarTexto(opts: {
  leadId: string;
  texto: string;
  autor: Autor;
  remetenteNome: string;
}): Promise<{ ok: true } | { error: string }> {
  const texto = opts.texto.trim();
  if (!texto) return { error: "Mensagem vazia" };
  const rota = await rotaDoLead(opts.leadId);
  if ("error" in rota) return rota;
  const r = await enviarComDestinos(rota, (dest) =>
    evoSendText({ instance: rota.instance, telefone: dest, texto }),
  );
  await registrar({
    rota,
    autor: opts.autor,
    remetenteNome: opts.remetenteNome,
    tipo: "texto",
    conteudo: texto,
    msgId: "msgId" in r ? r.msgId : null,
    falhou: "error" in r,
  });
  return "error" in r ? r : { ok: true };
}

export async function enviarArquivo(opts: {
  leadId: string;
  conteudo: Buffer;
  mime: string;
  nome: string;
  legenda?: string;
  autor: Autor;
  remetenteNome: string;
}): Promise<{ ok: true } | { error: string }> {
  const rota = await rotaDoLead(opts.leadId);
  if ("error" in rota) return rota;
  const tipo = tipoPorMime(opts.mime);
  const mediatype = tipo === "imagem" ? "image" : tipo === "video" ? "video" : "document";
  const base64 = opts.conteudo.toString("base64");
  const legenda = opts.legenda?.trim() || undefined;
  const r = await enviarComDestinos(rota, (dest) =>
    evoSendMedia({
      instance: rota.instance,
      telefone: dest,
      media: base64,
      mediatype,
      mimetype: opts.mime,
      caption: legenda,
      fileName: opts.nome,
    }),
  );
  const caminho = await salvarArquivo(opts.conteudo, opts.mime, opts.nome);
  await registrar({
    rota,
    autor: opts.autor,
    remetenteNome: opts.remetenteNome,
    tipo: tipo === "audio" ? "arquivo" : tipo,
    conteudo: legenda ?? null,
    msgId: "msgId" in r ? r.msgId : null,
    falhou: "error" in r,
    arquivoPath: caminho,
    arquivoNome: opts.nome,
    arquivoMime: opts.mime,
  });
  return "error" in r ? r : { ok: true };
}
