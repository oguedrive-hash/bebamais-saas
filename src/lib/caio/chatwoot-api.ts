/**
 * Cliente da API HTTP do Chatwoot.
 *
 * Server-side only. Usa o token da env var CHATWOOT_API_TOKEN.
 *
 * Todas as funções fazem try/catch internamente e retornam ou
 * `{ error: string }` ou um default safe — assim falhas de rede
 * (DNS, timeout, Chatwoot offline) não derrubam páginas inteiras.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { instanciaDoLead } from "./numeros";
import { enviarSerializado } from "./fila-envio";
import { evoSendText, evoSendAudio, evoSendMedia, evoSendPresence } from "./evolution-api";
import { salvarAudioBase64 } from "./storage-audio";

function config() {
  if (process.env.EVOLUTION_RECEBE === "1") throw new Error("Chatwoot desativado (migrado p/ Evolution)");
  // trim pra remover espaços que podem entrar por copy/paste no Vercel UI
  const url = (process.env.CHATWOOT_URL ?? "").trim().replace(/\/+$/, "");
  const accountId = (process.env.CHATWOOT_ACCOUNT_ID ?? "").trim();
  const token = (process.env.CHATWOOT_API_TOKEN ?? "").trim();

  if (!url) throw new Error("CHATWOOT_URL não está definida");
  if (!accountId) throw new Error("CHATWOOT_ACCOUNT_ID não está definida");
  if (!token) throw new Error("CHATWOOT_API_TOKEN não está definida");

  return {
    url,
    accountId,
    token,
    baseUrl: `${url}/api/v1/accounts/${accountId}`,
  };
}

async function safeFetch(
  url: string,
  init?: RequestInit,
): Promise<Response | { error: string }> {
  try {
    const res = await fetch(url, init);
    return res;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { error: `Falha de rede: ${msg}` };
  }
}

/**
 * Envia uma mensagem outgoing numa conversa.
 */
async function enviarMensagemRaw(opts: {
  conversationId: number;
  content: string;
}): Promise<{ id: number; content: string } | { error: string }> {
  let baseUrl: string;
  let token: string;
  try {
    ({ baseUrl, token } = config());
  } catch (e) {
    return { error: e instanceof Error ? e.message : "config inválida" };
  }

  const result = await safeFetch(
    `${baseUrl}/conversations/${opts.conversationId}/messages`,
    {
      method: "POST",
      headers: {
        api_access_token: token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        content: opts.content,
        message_type: "outgoing",
        private: false,
      }),
    },
  );
  if ("error" in result) return result;
  if (!result.ok) {
    const text = await result.text();
    return {
      error: `Chatwoot respondeu ${result.status}: ${text.slice(0, 300)}`,
    };
  }
  try {
    const data = (await result.json()) as { id: number; content: string };
    return { id: data.id, content: data.content };
  } catch {
    return { error: "Resposta do Chatwoot não é JSON válido" };
  }
}

/**
 * Envia uma mensagem outgoing COM áudio anexado.
 * Usa multipart/form-data porque tem arquivo.
 */
async function enviarMensagemComAudioRaw(opts: {
  conversationId: number;
  audio: ArrayBuffer;
  filename?: string;
  mimeType?: string;
  content?: string;
}): Promise<{ id: number } | { error: string }> {
  let baseUrl: string;
  let token: string;
  try {
    ({ baseUrl, token } = config());
  } catch (e) {
    return { error: e instanceof Error ? e.message : "config inválida" };
  }

  const form = new FormData();
  form.set("message_type", "outgoing");
  form.set("private", "false");
  if (opts.content) form.set("content", opts.content);
  const blob = new Blob([opts.audio], {
    type: opts.mimeType ?? "audio/mpeg",
  });
  const file = new File([blob], opts.filename ?? "audio.mp3", {
    type: opts.mimeType ?? "audio/mpeg",
  });
  form.append("attachments[]", file);

  // Timeout de 30s — se Evolution/WhatsApp estiver lento, melhor falhar
  // logo e cair pro fallback texto do que travar 60s+ esperando.
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);

  try {
    const res = await fetch(
      `${baseUrl}/conversations/${opts.conversationId}/messages`,
      {
        method: "POST",
        headers: { api_access_token: token },
        body: form,
        signal: controller.signal,
      },
    );
    clearTimeout(timeoutId);
    if (!res.ok) {
      const text = await res.text();
      return {
        error: `Chatwoot ${res.status}: ${text.slice(0, 300)}`,
      };
    }
    const data = (await res.json()) as { id: number };
    return { id: data.id };
  } catch (err) {
    clearTimeout(timeoutId);
    if (err instanceof Error && err.name === "AbortError") {
      return { error: "Chatwoot timeout (30s) — Evolution provavelmente está lento ou offline" };
    }
    return {
      error: err instanceof Error ? err.message : "fetch failed",
    };
  }
}

/**
 * Envia mensagem com anexo a partir de uma URL externa (Supabase Storage etc).
 * Baixa o arquivo e envia como multipart pro Chatwoot.
 *
 * Usado pra mandar imagens/videos pre-carregados em regras de follow-up.
 */
async function enviarMensagemComAnexoUrlRaw(opts: {
  conversationId: number;
  url: string;
  mimeType: string;
  caption?: string;
}): Promise<{ id: number } | { error: string }> {
  let baseUrl: string;
  let token: string;
  try {
    ({ baseUrl, token } = config());
  } catch (e) {
    return { error: e instanceof Error ? e.message : "config inválida" };
  }

  // Baixa o arquivo da URL
  const dl = await safeFetch(opts.url);
  if ("error" in dl) return { error: `Falha ao baixar anexo: ${dl.error}` };
  if (!dl.ok) {
    return { error: `Anexo retornou ${dl.status} ao baixar` };
  }
  const buf = await dl.arrayBuffer();

  // Define extensão pelo mime
  const extMap: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/gif": "gif",
    "image/webp": "webp",
    "video/mp4": "mp4",
    "video/webm": "webm",
  };
  const ext = extMap[opts.mimeType] ?? "bin";
  const filename = `anexo.${ext}`;

  const form = new FormData();
  form.set("message_type", "outgoing");
  form.set("private", "false");
  if (opts.caption) form.set("content", opts.caption);
  const blob = new Blob([buf], { type: opts.mimeType });
  const file = new File([blob], filename, { type: opts.mimeType });
  form.append("attachments[]", file);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 45000);

  try {
    const res = await fetch(
      `${baseUrl}/conversations/${opts.conversationId}/messages`,
      {
        method: "POST",
        headers: { api_access_token: token },
        body: form,
        signal: controller.signal,
      },
    );
    clearTimeout(timeoutId);
    if (!res.ok) {
      const text = await res.text();
      return {
        error: `Chatwoot ${res.status}: ${text.slice(0, 300)}`,
      };
    }
    const data = (await res.json()) as { id: number };
    return { id: data.id };
  } catch (err) {
    clearTimeout(timeoutId);
    if (err instanceof Error && err.name === "AbortError") {
      return { error: "Chatwoot timeout (45s) enviando anexo" };
    }
    return {
      error: err instanceof Error ? err.message : "fetch failed",
    };
  }
}

/**
 * Aplica (substitui) etiquetas numa conversa.
 */
export async function setLabels(opts: {
  conversationId: number;
  labels: string[];
}): Promise<{ ok: true } | { error: string }> {
  let baseUrl: string;
  let token: string;
  try {
    ({ baseUrl, token } = config());
  } catch (e) {
    return { error: e instanceof Error ? e.message : "config inválida" };
  }

  const result = await safeFetch(
    `${baseUrl}/conversations/${opts.conversationId}/labels`,
    {
      method: "POST",
      headers: {
        api_access_token: token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ labels: opts.labels }),
    },
  );
  if ("error" in result) return result;
  if (!result.ok) {
    const text = await result.text();
    return {
      error: `Chatwoot respondeu ${result.status}: ${text.slice(0, 300)}`,
    };
  }
  return { ok: true };
}

/**
 * Busca as labels atuais de uma conversa. Em caso de falha retorna [].
 */
export async function getLabels(opts: {
  conversationId: number;
}): Promise<string[]> {
  let baseUrl: string;
  let token: string;
  try {
    ({ baseUrl, token } = config());
  } catch {
    return [];
  }

  const result = await safeFetch(
    `${baseUrl}/conversations/${opts.conversationId}/labels`,
    { headers: { api_access_token: token } },
  );
  if ("error" in result) return [];
  if (!result.ok) return [];
  try {
    const data = (await result.json()) as { payload?: string[] };
    return data.payload ?? [];
  } catch {
    return [];
  }
}

/**
 * Adiciona uma label específica sem remover as outras.
 */
export async function addLabel(opts: {
  conversationId: number;
  label: string;
}): Promise<{ ok: true } | { error: string }> {
  const current = await getLabels({ conversationId: opts.conversationId });
  if (current.includes(opts.label)) return { ok: true };
  return setLabels({
    conversationId: opts.conversationId,
    labels: [...current, opts.label],
  });
}

/**
 * Muda status de uma conversa (resolved, open, pending).
 */
export async function toggleConversationStatus(opts: {
  conversationId: number;
  status: "open" | "resolved" | "pending";
}): Promise<{ ok: true } | { error: string }> {
  let baseUrl: string;
  let token: string;
  try {
    ({ baseUrl, token } = config());
  } catch (e) {
    return { error: e instanceof Error ? e.message : "config inválida" };
  }

  const result = await safeFetch(
    `${baseUrl}/conversations/${opts.conversationId}/toggle_status`,
    {
      method: "POST",
      headers: {
        api_access_token: token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ status: opts.status }),
    },
  );
  if ("error" in result) return result;
  if (!result.ok) {
    const text = await result.text();
    return {
      error: `Chatwoot respondeu ${result.status}: ${text.slice(0, 300)}`,
    };
  }
  return { ok: true };
}

/**
 * Cria uma conversa nova no inbox da org pra um lead de prospeccao
 * (lead nunca interagiu — precisa criar contato + conversa antes de mandar msg).
 *
 * Telefone deve estar em E.164 (5511999998888).
 *
 * Estrategia: tenta criar o contato (POST /contacts). Se o telefone ja existir
 * no Chatwoot, a API retorna 422 — nesse caso recuperamos via search e
 * reusamos. Depois cria conversa associando contact + inbox da org.
 */
export async function criarConversaProspeccao(opts: {
  organizationId: string;
  telefone: string;
  nome: string;
}): Promise<{ conversationId: number } | { error: string }> {
  // Migrado pra Evolution: não cria conversa no Chatwoot, só devolve um ID interno
  // único; quem chamou salva no lead e envia pela Evolution (por telefone).
  if (process.env.EVOLUTION_RECEBE === "1") {
    return { conversationId: Math.floor(Math.random() * 2000000000) };
  }
  let baseUrl: string;
  let token: string;
  try {
    ({ baseUrl, token } = config());
  } catch (e) {
    return { error: e instanceof Error ? e.message : "config inválida" };
  }

  // Pega inbox_id da org
  const admin = createAdminClient();
  const { data: org } = await admin
    .from("organizations")
    .select("chatwoot_inbox_id")
    .eq("id", opts.organizationId)
    .single();
  const inboxId = org?.chatwoot_inbox_id;
  if (!inboxId) {
    return {
      error: `Org ${opts.organizationId} não tem chatwoot_inbox_id configurado`,
    };
  }

  const telefoneE164 = opts.telefone.startsWith("+")
    ? opts.telefone
    : `+${opts.telefone}`;

  // Step 1: cria ou recupera contato
  let contactId: number | undefined;
  const createContactRes = await safeFetch(`${baseUrl}/contacts`, {
    method: "POST",
    headers: {
      api_access_token: token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      inbox_id: inboxId,
      name: opts.nome || telefoneE164,
      phone_number: telefoneE164,
    }),
  });
  if ("error" in createContactRes) return createContactRes;

  if (createContactRes.ok) {
    const data = (await createContactRes.json()) as {
      payload?: { contact?: { id: number } };
    };
    contactId = data.payload?.contact?.id;
  } else if (createContactRes.status === 422) {
    // Contato ja existe — busca pelo telefone
    const searchRes = await safeFetch(
      `${baseUrl}/contacts/search?q=${encodeURIComponent(telefoneE164)}&include=contact_inboxes`,
      {
        headers: { api_access_token: token },
      },
    );
    if ("error" in searchRes) return searchRes;
    if (!searchRes.ok) {
      const text = await searchRes.text();
      return {
        error: `Chatwoot search ${searchRes.status}: ${text.slice(0, 300)}`,
      };
    }
    const data = (await searchRes.json()) as {
      payload?: { id: number; phone_number?: string }[];
    };
    const match = data.payload?.find(
      (c) => c.phone_number === telefoneE164,
    );
    contactId = match?.id;
  } else {
    const text = await createContactRes.text();
    return {
      error: `Chatwoot create contact ${createContactRes.status}: ${text.slice(0, 300)}`,
    };
  }

  if (!contactId) {
    return { error: "Não conseguiu obter contact_id" };
  }

  // Step 2: garante contact_inbox (associa contato ao inbox)
  const ciRes = await safeFetch(
    `${baseUrl}/contacts/${contactId}/contact_inboxes`,
    {
      method: "POST",
      headers: {
        api_access_token: token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        inbox_id: inboxId,
        source_id: telefoneE164,
      }),
    },
  );
  if ("error" in ciRes) return ciRes;
  if (!ciRes.ok && ciRes.status !== 422) {
    const text = await ciRes.text();
    return {
      error: `Chatwoot contact_inboxes ${ciRes.status}: ${text.slice(0, 300)}`,
    };
  }
  let sourceId = telefoneE164;
  if (ciRes.ok) {
    try {
      const ciData = (await ciRes.json()) as { source_id?: string };
      if (ciData.source_id) sourceId = ciData.source_id;
    } catch {
      // ignora
    }
  }

  // Step 3: cria conversa
  const convRes = await safeFetch(`${baseUrl}/conversations`, {
    method: "POST",
    headers: {
      api_access_token: token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      source_id: sourceId,
      inbox_id: inboxId,
      contact_id: contactId,
      status: "open",
    }),
  });
  if ("error" in convRes) return convRes;
  if (!convRes.ok) {
    const text = await convRes.text();
    return {
      error: `Chatwoot create conversation ${convRes.status}: ${text.slice(0, 300)}`,
    };
  }
  try {
    const data = (await convRes.json()) as { id: number };
    return { conversationId: data.id };
  } catch (e) {
    return {
      error: `Resposta inesperada do Chatwoot: ${
        e instanceof Error ? e.message : "json invalido"
      }`,
    };
  }
}


// ===== Fila de envio serializada por org (anti-rajada no WhatsApp) =====
// Resolve a chave de fila a partir da conversa (cacheado): mensagens da mesma
// org saem uma por vez e espacadas; orgs diferentes nao se bloqueiam. Sem org
// (ex.: notificacao de admin) -> serializa pela propria conversa.
const _cacheDados = new Map<number, { chave: string; telefone: string | null; instance: string | null; leadId: string | null }>();
async function dadosEnvio(conversationId: number) {
  const c = _cacheDados.get(conversationId);
  if (c) return c;
  const r: { chave: string; telefone: string | null; instance: string | null; leadId: string | null } = { chave: `conv:${conversationId}`, telefone: null, instance: null, leadId: null };
  try {
    const admin = createAdminClient();
    const { data } = await admin.from("leads").select("id, organization_id, telefone, evolution_instance, whatsapp_jid").eq("chatwoot_conversation_id", conversationId).limit(1);
    const lead = data?.[0] as { id?: string; organization_id?: string; telefone?: string; evolution_instance?: string | null; whatsapp_jid?: string | null } | undefined;
    if (lead?.organization_id) {
      r.chave = `org:${lead.organization_id}`;
      // Prefere o JID @lid capturado no inbound (entrega a contatos migrados pro LID);
      // fallback pro telefone (contatos antigos / leads sem inbound ainda).
      r.telefone = lead.whatsapp_jid || lead.telefone || null;
      r.leadId = lead.id ?? null;
      // Fase 1 pool de números: roteia pelo número SERVINDO o lead (fallback: atendimento da org -> legado).
      r.instance = await instanciaDoLead(lead.organization_id, lead.evolution_instance ?? null);
    }
  } catch {
    // fallback seguro
  }
  _cacheDados.set(conversationId, r);
  return r;
}
async function chaveFila(conversationId: number): Promise<string> {
  return (await dadosEnvio(conversationId)).chave;
}
// Canary: telefones em EVOLUTION_ENVIO_TESTE enviam pela Evolution; o resto segue no Chatwoot.
function canaryEvolution(telefone: string | null): boolean {
  if (!telefone) return false;
  if (process.env.EVOLUTION_ENVIO_TODOS === "1") return true;
  const tel = telefone.replace(/\D/g, "");
  const lista = (process.env.EVOLUTION_ENVIO_TESTE ?? "").split(",").map((t) => t.replace(/\D/g, "")).filter(Boolean);
  return lista.some((t) => tel.endsWith(t) || t.endsWith(tel));
}

export async function enviarMensagem(opts: {
  conversationId: number;
  content: string;
}): Promise<{ id: number; content: string } | { error: string }> {
  const d = await dadosEnvio(opts.conversationId);
  return enviarSerializado(d.chave, async () => {
    if (d.instance && d.telefone && canaryEvolution(d.telefone)) {
      const r = await evoSendText({ instance: d.instance, telefone: d.telefone, texto: opts.content });
      if (!("error" in r)) {
        if (process.env.EVOLUTION_RECEBE === "1" && d.leadId) {
          try { const orgId = d.chave.startsWith("org:") ? d.chave.slice(4) : null; await createAdminClient().from("mensagens").insert({ organization_id: orgId, lead_id: d.leadId, direcao: "saida", tipo: "texto", conteudo: opts.content }); } catch (e) { console.error("[evo] persist outgoing falhou:", e); }
        }
        return { id: 0, content: opts.content };
      }
      console.error("[evo] envio falhou:", (r as { error: string }).error);
      return r; // Evolution é o canal ativo — propaga o erro real (ex: número inexistente) em vez de mascarar com o fallback morto do Chatwoot
    }
    return enviarMensagemRaw(opts);
  });
}

/**
 * Mostra "digitando..."/"gravando..." pro lead durante o tempo de preparo da
 * resposta. Resolve o telefone pelo conversationId e dispara presença na
 * Evolution. Fire-and-forget — nunca bloqueia nem derruba o envio.
 */
export async function sinalizarPresenca(
  conversationId: number,
  presence: "composing" | "recording",
  delayMs: number,
): Promise<void> {
  try {
    const d = await dadosEnvio(conversationId);
    if (d.instance && d.telefone && canaryEvolution(d.telefone)) {
      await evoSendPresence({ instance: d.instance, telefone: d.telefone, presence, delayMs });
    }
  } catch (e) {
    console.warn("[caio:presenca] falhou:", e instanceof Error ? e.message : e);
  }
}

export async function enviarMensagemComAudio(opts: {
  conversationId: number;
  audio: ArrayBuffer;
  filename?: string;
  mimeType?: string;
  content?: string;
}): Promise<{ id: number } | { error: string }> {
  const d = await dadosEnvio(opts.conversationId);
  return enviarSerializado(d.chave, async () => {
    if (d.instance && d.telefone && canaryEvolution(d.telefone)) {
      const b64 = Buffer.from(opts.audio).toString("base64");
      const r = await evoSendAudio({ instance: d.instance, telefone: d.telefone, audioBase64: b64 });
      if (!("error" in r)) {
        if (process.env.EVOLUTION_RECEBE === "1" && d.leadId) {
          try { const orgId = d.chave.startsWith("org:") ? d.chave.slice(4) : null; const attachmentUrl = await salvarAudioBase64(b64, "mp3", opts.mimeType ?? "audio/mpeg"); await createAdminClient().from("mensagens").insert({ organization_id: orgId, lead_id: d.leadId, direcao: "saida", tipo: "audio", conteudo: opts.content ?? "", attachment_url: attachmentUrl }); } catch (e) { console.error("[evo] persist audio out:", e); }
        }
        return { id: 0 };
      }
      console.error("[evo] envio audio falhou:", (r as { error: string }).error);
      return r; // propaga erro real da Evolution (canal ativo), sem fallback morto do Chatwoot
    }
    return enviarMensagemComAudioRaw(opts);
  });
}

export async function enviarMensagemComAnexoUrl(opts: {
  conversationId: number;
  url: string;
  mimeType: string;
  caption?: string;
}): Promise<{ id: number } | { error: string }> {
  const d = await dadosEnvio(opts.conversationId);
  return enviarSerializado(d.chave, async () => {
    if (d.instance && d.telefone && canaryEvolution(d.telefone)) {
      const mediatype = opts.mimeType.startsWith("image") ? "image" : opts.mimeType.startsWith("video") ? "video" : "document";
      const r = await evoSendMedia({ instance: d.instance, telefone: d.telefone, media: opts.url, mediatype, mimetype: opts.mimeType, caption: opts.caption });
      if (!("error" in r)) {
        if (process.env.EVOLUTION_RECEBE === "1" && d.leadId) {
          try { const orgId = d.chave.startsWith("org:") ? d.chave.slice(4) : null; const tipo = mediatype === "image" ? "imagem" : mediatype === "video" ? "video" : "arquivo"; await createAdminClient().from("mensagens").insert({ organization_id: orgId, lead_id: d.leadId, direcao: "saida", tipo, conteudo: opts.caption ?? "" }); } catch (e) { console.error("[evo] persist media out:", e); }
        }
        return { id: 0 };
      }
      console.error("[evo] envio media falhou:", (r as { error: string }).error);
      return r; // propaga erro real da Evolution (canal ativo), sem fallback morto do Chatwoot
    }
    return enviarMensagemComAnexoUrlRaw(opts);
  });
}
