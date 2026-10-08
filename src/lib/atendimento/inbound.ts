/**
 * Mensagens que chegam pelo WhatsApp (webhook da Evolution).
 *
 * - Do CLIENTE: guarda no histórico (texto, áudio transcrito, foto, arquivo,
 *   localização), atualiza o estado da conversa e, se for a vez do assistente,
 *   agenda a resposta.
 * - Do PRÓPRIO número (alguém respondeu pelo celular ou WhatsApp Web): guarda no
 *   histórico e tira o assistente da conversa, para ele nunca falar junto.
 */
import { createAdminClient } from "@/lib/supabase/admin";
import { evoBaixarMidia } from "@/lib/caio/evolution-api";
import { ORG_ID, INSTANCE_NAME } from "@/lib/caio/config";
import { salvarArquivo } from "./arquivos";
import { foiEnviadoPeloSistema } from "./whatsapp";
import { decidirEntrada, normalizarConfig, type AtendStatus } from "./regras";
import { agendarResposta } from "./assistente";

export type EvoKey = { remoteJid?: string; remoteJidAlt?: string; fromMe?: boolean; id?: string };
type Msg = Record<string, unknown> | undefined;
export type EvoMensagem = { key?: EvoKey; pushName?: string; message?: Msg; messageType?: string };

export interface Normalizada {
  tipo: "texto" | "audio" | "imagem" | "arquivo" | "video" | "localizacao";
  texto: string | null;
  midia: { mime: string; nome: string | null } | null; // precisa baixar
  ignorar: boolean; // reação, mensagem apagada, etc.
}

/** Tira os "envelopes" do WhatsApp (mensagem temporária, ver uma vez, documento com legenda). */
function desembrulhar(m: Msg): Msg {
  let atual = m;
  for (let i = 0; i < 4 && atual; i++) {
    const env =
      (atual.ephemeralMessage as { message?: Msg } | undefined) ??
      (atual.viewOnceMessage as { message?: Msg } | undefined) ??
      (atual.viewOnceMessageV2 as { message?: Msg } | undefined) ??
      (atual.documentWithCaptionMessage as { message?: Msg } | undefined);
    if (!env?.message) break;
    atual = env.message;
  }
  return atual;
}

/** Converte a mensagem do WhatsApp num formato simples. Função pura (testável). */
export function normalizarMensagem(bruta: Msg): Normalizada {
  const m = desembrulhar(bruta) ?? {};
  const s = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  if (m.reactionMessage || m.protocolMessage || m.pollUpdateMessage || m.senderKeyDistributionMessage && Object.keys(m).length === 1) {
    return { tipo: "texto", texto: null, midia: null, ignorar: true };
  }
  if (s(m.conversation)) return { tipo: "texto", texto: s(m.conversation), midia: null, ignorar: false };
  const ext = m.extendedTextMessage as { text?: string } | undefined;
  if (s(ext?.text)) return { tipo: "texto", texto: s(ext?.text), midia: null, ignorar: false };

  const img = m.imageMessage as { caption?: string; mimetype?: string } | undefined;
  if (img) return { tipo: "imagem", texto: s(img.caption), midia: { mime: img.mimetype ?? "image/jpeg", nome: null }, ignorar: false };

  const doc = m.documentMessage as { caption?: string; mimetype?: string; fileName?: string; title?: string } | undefined;
  if (doc) {
    return {
      tipo: "arquivo",
      texto: s(doc.caption),
      midia: { mime: doc.mimetype ?? "application/octet-stream", nome: s(doc.fileName) ?? s(doc.title) },
      ignorar: false,
    };
  }
  const aud = m.audioMessage as { mimetype?: string } | undefined;
  if (aud) return { tipo: "audio", texto: null, midia: { mime: (aud.mimetype ?? "audio/ogg").split(";")[0], nome: null }, ignorar: false };

  const vid = m.videoMessage as { caption?: string; mimetype?: string } | undefined;
  if (vid) return { tipo: "video", texto: s(vid.caption), midia: { mime: vid.mimetype ?? "video/mp4", nome: null }, ignorar: false };

  const loc = (m.locationMessage ?? m.liveLocationMessage) as
    | { degreesLatitude?: number; degreesLongitude?: number; name?: string; address?: string }
    | undefined;
  if (loc && typeof loc.degreesLatitude === "number" && typeof loc.degreesLongitude === "number") {
    const nome = [s(loc.name), s(loc.address)].filter(Boolean).join(" - ");
    const link = `https://maps.google.com/?q=${loc.degreesLatitude},${loc.degreesLongitude}`;
    return { tipo: "localizacao", texto: nome ? `${nome}\n${link}` : link, midia: null, ignorar: false };
  }
  const contato = m.contactMessage as { displayName?: string; vcard?: string } | undefined;
  if (contato) {
    const tel = contato.vcard?.match(/waid=(\d+)|TEL[^:]*:([+\d\s-]+)/);
    const numero = (tel?.[1] ?? tel?.[2] ?? "").trim();
    return { tipo: "texto", texto: `Contato compartilhado: ${s(contato.displayName) ?? ""}${numero ? ` (${numero})` : ""}`.trim(), midia: null, ignorar: false };
  }
  if (m.stickerMessage) return { tipo: "texto", texto: "(figurinha)", midia: null, ignorar: false };
  return { tipo: "texto", texto: null, midia: null, ignorar: true };
}

/** Transcreve áudio com o Whisper (texto vai para o histórico e para o assistente). */
async function transcrever(base64: string, mime: string): Promise<string | null> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  try {
    const form = new FormData();
    form.set("file", new File([Buffer.from(base64, "base64")], "audio.ogg", { type: mime || "audio/ogg" }));
    form.set("model", process.env.OPENAI_WHISPER_MODEL ?? "whisper-1");
    form.set("language", "pt");
    const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      body: form,
      signal: AbortSignal.timeout(60000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { text?: string };
    return data.text?.trim() || null;
  } catch {
    return null;
  }
}

function maisRecente(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return new Date(a).getTime() >= new Date(b).getTime() ? a : b;
}

function identificar(key: EvoKey | undefined) {
  const rjid = key?.remoteJid ?? "";
  const alt = key?.remoteJidAlt ?? "";
  const numeroJid = [rjid, alt].find((j) => j.endsWith("@s.whatsapp.net")) ?? "";
  const lidJid = [rjid, alt].find((j) => j.endsWith("@lid")) ?? "";
  return {
    ehGrupo: rjid.endsWith("@g.us") || alt.endsWith("@g.us") || rjid === "status@broadcast",
    telefone: numeroJid.replace(/@.*/, "").replace(/\D/g, ""),
    lidJid,
  };
}

interface NumeroInfo {
  conhecido: boolean;
  assistenteLigado: boolean;
  testes: string[];
}

async function infoDoNumero(instance: string): Promise<NumeroInfo> {
  const { data } = await createAdminClient()
    .from("org_numeros")
    .select("ia_ativa, numeros_teste, ativo")
    .eq("instance_name", instance)
    .maybeSingle();
  if (!data) return { conhecido: instance === INSTANCE_NAME && !!INSTANCE_NAME, assistenteLigado: true, testes: [] };
  return {
    conhecido: data.ativo !== false,
    assistenteLigado: data.ia_ativa !== false,
    testes: String(data.numeros_teste ?? "")
      .split(/[\s,;]+/)
      .map((t) => t.replace(/\D/g, ""))
      .filter(Boolean),
  };
}

interface ClienteLinha {
  id: string;
  atend_status: AtendStatus;
  caio_ativo: boolean;
  atribuido_a: string | null;
  ultima_atividade_em: string | null;
  ultima_msg_lead_em: string | null;
  updated_at: string | null;
  nome: string | null;
}

const CAMPOS_CLIENTE = "id, atend_status, caio_ativo, atribuido_a, ultima_atividade_em, ultima_msg_lead_em, updated_at, nome";

async function buscarCliente(telefone: string, lidJid: string): Promise<ClienteLinha | null> {
  const admin = createAdminClient();
  if (telefone) {
    const { data } = await admin.from("leads").select(CAMPOS_CLIENTE).eq("organization_id", ORG_ID).eq("telefone_digitos", telefone).limit(1);
    if (data?.[0]) return data[0] as ClienteLinha;
  }
  if (lidJid) {
    const { data } = await admin.from("leads").select(CAMPOS_CLIENTE).eq("organization_id", ORG_ID).eq("whatsapp_jid", lidJid).limit(1);
    if (data?.[0]) return data[0] as ClienteLinha;
  }
  return null;
}

/** Acha o cliente pelo telefone (ou pelo @lid), ou cria. */
async function acharOuCriarCliente(telefone: string, lidJid: string, nome: string | null) {
  const existente = await buscarCliente(telefone, lidJid);
  if (existente) return { lead: existente, novo: false };
  const digitos = telefone || lidJid.replace(/@.*/, "").replace(/\D/g, "");
  if (!digitos) return null;
  const { data: novo, error } = await createAdminClient()
    .from("leads")
    .insert({
      organization_id: ORG_ID,
      telefone: `+${digitos}`,
      telefone_digitos: digitos,
      nome,
      status: "em_conversa",
      origem: "inbound",
      source: "whatsapp",
      whatsapp_jid: lidJid || null,
      atend_status: "bot",
    })
    .select(CAMPOS_CLIENTE)
    .single();
  if (novo) return { lead: novo as ClienteLinha, novo: true };
  // Duas mensagens do mesmo cliente novo chegando juntas: a outra já criou.
  if (error?.code === "23505") {
    const criado = await buscarCliente(telefone, lidJid);
    if (criado) return { lead: criado, novo: false };
  }
  console.error("[inbound] não criou cliente:", error?.message);
  return null;
}

function atividadeDe(lead: ClienteLinha): string | null {
  return lead.ultima_atividade_em ?? maisRecente(lead.ultima_msg_lead_em, lead.updated_at);
}

function camposDeConversaNova(agora: Date): Record<string, unknown> {
  return {
    conversa_iniciada_em: agora.toISOString(),
    respostas_bot: 0,
    assunto: null,
    avisos_espera: 0,
    ultimo_aviso_em: null,
    atribuido_a: null,
    atribuido_nome: null,
    atribuido_em: null,
    finalizado_em: null,
    assistente_viu_ate: null,
    caio_ativo: true,
  };
}

export async function processarMensagem(instance: string, d: EvoMensagem): Promise<void> {
  const { ehGrupo, telefone, lidJid } = identificar(d.key);
  if (ehGrupo || (!telefone && !lidJid)) return;

  const numero = await infoDoNumero(instance);
  if (!numero.conhecido) {
    console.warn("[inbound] mensagem de número não cadastrado, ignorada:", instance);
    return;
  }

  const admin = createAdminClient();
  const msgId = d.key?.id ?? null;
  const jaGravada = async () => {
    if (!msgId) return false;
    const { data } = await admin.from("mensagens").select("id").eq("whatsapp_msg_id", msgId).limit(1);
    return !!data?.length;
  };
  if (await jaGravada()) return; // a Evolution às vezes reenvia o mesmo evento

  const fromMe = d.key?.fromMe === true;
  if (fromMe) {
    // A Evolution também avisa das mensagens que o PRÓPRIO sistema mandou.
    // Espera o envio se registrar antes de concluir que foi alguém pelo celular.
    await new Promise((r) => setTimeout(r, 4000));
    if (msgId && foiEnviadoPeloSistema(msgId)) return;
    if (await jaGravada()) return;
  }

  const n = normalizarMensagem(d.message);
  if (n.ignorar) return;

  let texto = n.texto;
  let arquivoPath: string | null = null;
  if (n.midia) {
    const baixada = await evoBaixarMidia(instance, d.key);
    if (baixada) {
      const mime = baixada.mimetype?.split(";")[0] || n.midia.mime;
      arquivoPath = await salvarArquivo(Buffer.from(baixada.base64, "base64"), mime, n.midia.nome);
      if (n.tipo === "audio") texto = await transcrever(baixada.base64, mime);
    }
  }

  const achado = await acharOuCriarCliente(telefone, lidJid, fromMe ? null : d.pushName?.trim() || null);
  if (!achado) return;
  const lead = achado.lead;
  const agora = new Date();

  const linha = {
    organization_id: ORG_ID,
    lead_id: lead.id,
    direcao: fromMe ? "saida" : "entrada",
    autor: fromMe ? "celular" : "cliente",
    remetente_nome: fromMe ? "Pelo celular" : lead.nome,
    tipo: n.tipo,
    conteudo: texto,
    whatsapp_msg_id: msgId,
    arquivo_path: arquivoPath,
    arquivo_nome: n.midia?.nome ?? null,
    arquivo_mime: n.midia?.mime ?? null,
    created_at: agora.toISOString(),
  };
  if (msgId) {
    // Grava uma vez só: se dois avisos iguais chegarem juntos, só um segue.
    const { data: gravou } = await admin
      .from("mensagens")
      .upsert(linha, { onConflict: "whatsapp_msg_id", ignoreDuplicates: true })
      .select("id");
    if (!gravou?.length) return;
  } else {
    await admin.from("mensagens").insert(linha);
  }

  const { data: org } = await admin.from("organizations").select("atendimento_config").eq("id", ORG_ID).maybeSingle();
  const cfg = normalizarConfig(org?.atendimento_config);

  // Atualiza o estado com "trava otimista": se outra coisa mudou o estado no meio
  // (atendente pegou, assistente passou a conversa), relê e decide de novo.
  let atual: ClienteLinha | null = lead;
  for (let tentativa = 0; tentativa < 3 && atual; tentativa++) {
    const upd: Record<string, unknown> = { ultima_atividade_em: agora.toISOString() };
    let assistenteResponde = false;

    if (fromMe) {
      // Alguém da loja respondeu pelo celular: o assistente sai desta conversa.
      const comAtendente = atual.atend_status === "atendendo" && !!atual.atribuido_a;
      if (!comAtendente) {
        if (atual.atend_status !== "atendendo" && atual.atend_status !== "aguardando" && atual.atend_status !== "bot") {
          Object.assign(upd, camposDeConversaNova(agora)); // estava finalizado: conversa nova, pela loja
        }
        Object.assign(upd, { atend_status: "atendendo", atribuido_a: null, atribuido_nome: "Pelo celular", atribuido_em: agora.toISOString() });
      }
      upd.caio_responder_em = null;
    } else {
      const naListaDeTeste =
        numero.testes.length === 0 ||
        numero.testes.some((t) => telefone.endsWith(t) || (t.endsWith(telefone) && telefone.length >= 8));
      const decisao = decidirEntrada(
        {
          atend_status: atual.atend_status,
          ultima_atividade_em: achado.novo && tentativa === 0 ? null : atividadeDe(atual),
          caio_ativo: atual.caio_ativo,
        },
        cfg,
        agora,
        numero.assistenteLigado && naListaDeTeste,
      );
      Object.assign(upd, {
        ultima_msg_lead_em: agora.toISOString(),
        evolution_instance: instance, // responde pelo número em que o cliente escreveu
        atend_status: decisao.status,
      });
      if (lidJid) upd.whatsapp_jid = lidJid;
      if (!atual.nome && d.pushName?.trim()) upd.nome = d.pushName.trim();
      if (decisao.novaConversa) {
        Object.assign(upd, camposDeConversaNova(agora));
        upd.aguardando_desde = decisao.status === "aguardando" ? agora.toISOString() : null;
      } else if (decisao.status === "aguardando" && atual.atend_status !== "aguardando") {
        upd.aguardando_desde = agora.toISOString();
        upd.avisos_espera = 0;
      }
      assistenteResponde = decisao.assistenteResponde;
    }

    const { data: aplicado } = await admin
      .from("leads")
      .update(upd)
      .eq("id", lead.id)
      .eq("atend_status", atual.atend_status)
      .select("id");
    if (aplicado?.length) {
      if (assistenteResponde) await agendarResposta(lead.id);
      return;
    }
    const { data: relido } = await admin.from("leads").select(CAMPOS_CLIENTE).eq("id", lead.id).maybeSingle();
    atual = (relido as ClienteLinha | null) ?? null;
  }
  console.warn("[inbound] estado do cliente mudou várias vezes seguidas; mensagem registrada sem mudar o estado", lead.id);
}

/** Atualiza o status de conexão do número (aparece no painel do admin). */
export async function atualizarConexao(instance: string, estado: string): Promise<void> {
  const status = estado === "open" ? "open" : estado === "close" || estado === "DISCONNECTED" ? "close" : estado;
  if (!status) return;
  await createAdminClient().from("org_numeros").update({ status_conexao: status }).eq("instance_name", instance);
}
