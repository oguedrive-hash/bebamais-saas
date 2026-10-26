/**
 * Grupos do WhatsApp (aba "Grupos" do painel).
 *
 * A loja usa grupos internos no mesmo WhatsApp (financeiro com comprovantes,
 * estoque, quem está na rua). Aqui eles só são GUARDADOS e mostrados: o
 * assistente nunca responde em grupo, grupo não entra na fila de espera e não
 * toca aviso. Qualquer pessoa da equipe pode responder pelo painel.
 *
 * Tabelas próprias (`grupos`, `grupo_mensagens`), separadas de clientes.
 */
import { createAdminClient } from "@/lib/supabase/admin";
import { aguardarAceite, evoBaixarMidia, evoSendMedia, evoSendText } from "@/lib/caio/evolution-api";
import { evoNomeDoGrupo } from "@/lib/caio/evolution-admin";
import { INSTANCE_NAME, ORG_ID } from "@/lib/caio/config";
import { normalizarMensagem, type EvoKey, type EvoMensagem } from "./inbound";
import { salvarArquivo, tipoPorMime } from "./arquivos";
import { foiEnviadoPeloSistema, registrarEnvioDoSistema } from "./whatsapp";
import { assinar, assinarLegenda } from "./assinatura";

/** O nome do grupo é conferido de novo uma vez por dia (alguém pode ter renomeado). */
const NOME_VALE_POR_MS = 24 * 60 * 60 * 1000;

/** JID do grupo (…@g.us) quando a mensagem é de grupo; null se não for. */
export function grupoDaMensagem(key: EvoKey | undefined): string | null {
  const rjid = key?.remoteJid ?? "";
  const alt = key?.remoteJidAlt ?? "";
  if (rjid.endsWith("@g.us")) return rjid;
  if (alt.endsWith("@g.us")) return alt;
  return null;
}

/** Número (só dígitos) de quem mandou a mensagem no grupo, quando o WhatsApp informa. */
export function numeroDoParticipante(key: EvoKey | undefined): string | null {
  const jid = [key?.participant ?? "", key?.participantAlt ?? ""].find((j) => j.endsWith("@s.whatsapp.net"));
  const d = jid ? jid.replace(/@.*/, "").replace(/\D/g, "") : "";
  return d || null;
}

/** O número da loja por onde o grupo chegou está cadastrado e ativo? */
async function numeroConhecido(instance: string): Promise<boolean> {
  const { data } = await createAdminClient()
    .from("org_numeros")
    .select("ativo")
    .eq("instance_name", instance)
    .maybeSingle();
  if (!data) return instance === INSTANCE_NAME && !!INSTANCE_NAME;
  return data.ativo !== false;
}

/** Acha ou cria o grupo e confere o nome (no máximo uma vez por dia). */
async function acharOuCriarGrupo(instance: string, grupoJid: string): Promise<string | null> {
  const admin = createAdminClient();
  const { data: grupo, error } = await admin
    .from("grupos")
    .upsert(
      { organization_id: ORG_ID, instance_name: instance, grupo_jid: grupoJid },
      { onConflict: "instance_name,grupo_jid" },
    )
    .select("id, nome, nome_atualizado_em")
    .single();
  if (!grupo) {
    console.error("[grupos] não criou o grupo:", error?.message);
    return null;
  }
  const velho = !grupo.nome_atualizado_em || Date.now() - new Date(grupo.nome_atualizado_em).getTime() > NOME_VALE_POR_MS;
  if (!grupo.nome || velho) {
    const nome = await evoNomeDoGrupo(instance, grupoJid);
    if (nome || !grupo.nome) {
      await admin
        .from("grupos")
        .update({ nome: nome ?? grupo.nome, nome_atualizado_em: new Date().toISOString() })
        .eq("id", grupo.id);
    }
  }
  return grupo.id;
}

/** Mensagem que chegou num grupo (de alguém do grupo ou pelo celular da loja). */
export async function processarMensagemDeGrupo(instance: string, d: EvoMensagem): Promise<void> {
  const grupoJid = grupoDaMensagem(d.key);
  if (!grupoJid) return;
  if (!(await numeroConhecido(instance))) return;

  const admin = createAdminClient();
  const msgId = d.key?.id ?? null;
  const jaGravada = async () => {
    if (!msgId) return false;
    const { data } = await admin.from("grupo_mensagens").select("id").eq("whatsapp_msg_id", msgId).limit(1);
    return !!data?.length;
  };
  if (await jaGravada()) return; // a Evolution às vezes reenvia o mesmo evento

  const fromMe = d.key?.fromMe === true;
  if (fromMe) {
    // A Evolution também avisa das mensagens que o PRÓPRIO painel mandou: espera o
    // envio se registrar antes de concluir que foi alguém pelo celular.
    await new Promise((r) => setTimeout(r, 4000));
    if (msgId && foiEnviadoPeloSistema(msgId)) return;
    if (await jaGravada()) return;
  }

  const n = normalizarMensagem(d.message);
  if (n.ignorar) return;

  // Fotos e arquivos (comprovantes!) ficam guardados como nas conversas de clientes.
  let arquivoPath: string | null = null;
  if (n.midia) {
    const baixada = await evoBaixarMidia(instance, d.key);
    if (baixada) {
      const mime = baixada.mimetype?.split(";")[0] || n.midia.mime;
      arquivoPath = await salvarArquivo(Buffer.from(baixada.base64, "base64"), mime, n.midia.nome);
    }
  }

  const grupoId = await acharOuCriarGrupo(instance, grupoJid);
  if (!grupoId) return;
  const agora = new Date().toISOString();
  const { error } = await admin.from("grupo_mensagens").upsert(
    {
      organization_id: ORG_ID,
      grupo_id: grupoId,
      direcao: fromMe ? "saida" : "entrada",
      autor: fromMe ? "celular" : "membro",
      remetente_nome: fromMe ? "Pelo celular" : d.pushName?.trim() || null,
      remetente_numero: fromMe ? null : numeroDoParticipante(d.key),
      tipo: n.tipo,
      conteudo: n.texto,
      whatsapp_msg_id: msgId,
      arquivo_path: arquivoPath,
      arquivo_nome: n.midia?.nome ?? null,
      arquivo_mime: n.midia?.mime ?? null,
      created_at: agora,
    },
    { onConflict: "whatsapp_msg_id", ignoreDuplicates: true },
  );
  if (error) {
    console.error("[grupos] não gravou a mensagem:", error.message);
    return;
  }
  await admin.from("grupos").update({ ultima_atividade_em: agora }).eq("id", grupoId);
}

interface RotaGrupo {
  id: string;
  orgId: string;
  instance: string;
  jid: string;
}

async function rotaDoGrupo(grupoId: string): Promise<RotaGrupo | { error: string }> {
  const admin = createAdminClient();
  const { data: g } = await admin
    .from("grupos")
    .select("id, organization_id, instance_name, grupo_jid")
    .eq("id", grupoId)
    .maybeSingle();
  if (!g) return { error: "Grupo não encontrado" };
  const { data: num } = await admin
    .from("org_numeros")
    .select("instance_name")
    .eq("instance_name", g.instance_name)
    .eq("ativo", true)
    .maybeSingle();
  if (!num && g.instance_name !== INSTANCE_NAME) {
    return { error: "O número de WhatsApp deste grupo não está mais ligado ao sistema" };
  }
  return { id: g.id, orgId: g.organization_id, instance: g.instance_name, jid: g.grupo_jid };
}

async function registrarSaida(
  rota: RotaGrupo,
  dados: {
    remetenteNome: string;
    tipo: string;
    conteudo: string | null;
    msgId: string | null;
    falhou: boolean;
    arquivoPath?: string | null;
    arquivoNome?: string | null;
    arquivoMime?: string | null;
  },
) {
  const admin = createAdminClient();
  const agora = new Date().toISOString();
  const linha = {
    organization_id: rota.orgId,
    grupo_id: rota.id,
    direcao: "saida",
    autor: "atendente",
    remetente_nome: dados.remetenteNome,
    tipo: dados.tipo,
    conteudo: dados.conteudo,
    whatsapp_msg_id: dados.msgId,
    falha_envio: dados.falhou,
    arquivo_path: dados.arquivoPath ?? null,
    arquivo_nome: dados.arquivoNome ?? null,
    arquivo_mime: dados.arquivoMime ?? null,
    created_at: agora,
  };
  // Se o webhook já tiver gravado esta mensagem como "pelo celular", esta versão
  // (com o nome de quem mandou pelo painel) substitui.
  const { error } = dados.msgId
    ? await admin.from("grupo_mensagens").upsert(linha, { onConflict: "whatsapp_msg_id" })
    : await admin.from("grupo_mensagens").insert(linha);
  if (error) console.error("[grupos] não registrou a mensagem enviada:", error.message);
  await admin.from("grupos").update({ ultima_atividade_em: agora }).eq("id", rota.id);
}

/** Confere se o WhatsApp aceitou o envio. */
async function confirmarEnvio(
  rota: RotaGrupo,
  env: { id: string } | { error: string },
): Promise<{ msgId: string } | { error: string }> {
  if ("error" in env) return env;
  registrarEnvioDoSistema(env.id);
  if (!(await aguardarAceite(rota.instance, env.id))) return { error: "o WhatsApp recusou a mensagem" };
  return { msgId: env.id };
}

export async function enviarTextoGrupo(opts: {
  grupoId: string;
  texto: string;
  remetenteNome: string;
}): Promise<{ ok: true } | { error: string }> {
  const texto = opts.texto.trim();
  if (!texto) return { error: "Mensagem vazia" };
  const rota = await rotaDoGrupo(opts.grupoId);
  if ("error" in rota) return rota;
  const r = await confirmarEnvio(rota, await evoSendText({ instance: rota.instance, telefone: rota.jid, texto: assinar(opts.remetenteNome, texto) }));
  await registrarSaida(rota, {
    remetenteNome: opts.remetenteNome,
    tipo: "texto",
    conteudo: texto,
    msgId: "msgId" in r ? r.msgId : null,
    falhou: "error" in r,
  });
  return "error" in r ? r : { ok: true };
}

export async function enviarArquivoGrupo(opts: {
  grupoId: string;
  conteudo: Buffer;
  mime: string;
  nome: string;
  legenda?: string;
  remetenteNome: string;
}): Promise<{ ok: true } | { error: string }> {
  const rota = await rotaDoGrupo(opts.grupoId);
  if ("error" in rota) return rota;
  const tipo = tipoPorMime(opts.mime);
  const legenda = opts.legenda?.trim() || undefined;
  const r = await confirmarEnvio(
    rota,
    await evoSendMedia({
      instance: rota.instance,
      telefone: rota.jid,
      media: opts.conteudo.toString("base64"),
      mediatype: tipo === "imagem" ? "image" : tipo === "video" ? "video" : "document",
      mimetype: opts.mime,
      caption: assinarLegenda(opts.remetenteNome, legenda),
      fileName: opts.nome,
    }),
  );
  const caminho = await salvarArquivo(opts.conteudo, opts.mime, opts.nome);
  await registrarSaida(rota, {
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
