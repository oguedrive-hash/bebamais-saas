/**
 * Cliente da Evolution API — envio direto pelo WhatsApp.
 * Parte da migração que tira o Chatwoot do meio (envio direto na Evolution).
 * Server-side. Usa EVOLUTION_API_URL + EVOLUTION_API_KEY (env). Envia POR NÚMERO
 * (telefone), não por conversationId — esse é o ponto que difere do chatwoot-api.
 */

function config() {
  const url = (process.env.EVOLUTION_API_URL ?? "").trim().replace(/\/+$/, "");
  const key = (process.env.EVOLUTION_API_KEY ?? "").trim();
  if (!url) throw new Error("EVOLUTION_API_URL não definida");
  if (!key) throw new Error("EVOLUTION_API_KEY não definida");
  return { url, key };
}

function soDigitos(tel: string): string {
  return (tel || "").replace(/\D/g, "");
}

// Destino do envio: se já vier um JID (@lid / @s.whatsapp.net), usa como está.
// Crucial pra ENTREGAR: o WhatsApp migra contatos pro "LID" (addressingMode=lid) e
// quem está migrado NÃO recebe no @s.whatsapp.net (fica PENDING) — tem que mandar
// pro @lid. Número solto continua virando só dígitos (a Evolution monta o JID).
function resolverDestino(dest: string): string {
  const d = (dest || "").trim();
  return d.includes("@") ? d : soDigitos(d);
}

/**
 * Estado da conexão do WhatsApp na Evolution: "open" | "connecting" | "close" | ...
 * Usado como guarda anti-hammer antes de enviar. Em erro/timeout retorna
 * "unknown" — quem chama trata "unknown" como fail-open (não bloqueia o envio
 * por um hiccup do check).
 */
export async function evoConnectionState(instance: string): Promise<string> {
  let url: string, key: string;
  try {
    ({ url, key } = config());
  } catch {
    return "unknown";
  }
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(`${url}/instance/connectionState/${instance}`, {
      headers: { apikey: key },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (!res.ok) return "unknown";
    const data = (await res.json()) as { instance?: { state?: string } };
    return data?.instance?.state ?? "unknown";
  } catch {
    clearTimeout(timeoutId);
    return "unknown";
  }
}

async function postEvolution(
  instance: string,
  rota: string,
  body: unknown,
  grupo: "message" | "chat" = "message",
): Promise<{ id: string } | { error: string }> {
  let url: string, key: string;
  try {
    ({ url, key } = config());
  } catch (e) {
    return { error: e instanceof Error ? e.message : "config inválida" };
  }

  // Guarda anti-hammer: se o WhatsApp está COMPROVADAMENTE desconectado
  // ("close" — ex.: o device_removed que derrubou o Caio em 10/06 e 19/06),
  // NÃO envia: só fail-fast. Evita a tempestade de "Connection Closed" pós-logout
  // e poupa o número de parecer bot tentando mandar offline. Só vale pra envio de
  // mensagem (grupo "message"); presença (grupo "chat") é fire-and-forget. Em
  // "unknown"/timeout do check, segue o envio (fail-open) pra não travar o Caio.
  if (grupo === "message") {
    const estado = await evoConnectionState(instance);
    if (estado === "close") {
      console.error(
        `[evolution-api] envio BLOQUEADO: instância "${instance}" desconectada (state=close). Reconectar via QR.`,
      );
      return { error: "WhatsApp desconectado (state=close) — envio bloqueado" };
    }
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);
  try {
    const res = await fetch(`${url}/${grupo}/${rota}/${instance}`, {
      method: "POST",
      headers: { apikey: key, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (!res.ok) {
      const text = await res.text();
      return { error: `Evolution ${res.status}: ${text.slice(0, 300)}` };
    }
    const data = (await res.json()) as { key?: { id?: string } };
    return { id: data?.key?.id ?? "ok" };
  } catch (err) {
    clearTimeout(timeoutId);
    if (err instanceof Error && err.name === "AbortError") {
      return { error: "Evolution timeout (30s)" };
    }
    return { error: err instanceof Error ? err.message : "fetch failed" };
  }
}

/**
 * Resolve o JID @lid de um número na Evolution. O WhatsApp migra contatos pro
 * "LID" (addressingMode=lid) e quem está migrado SÓ recebe no @lid — no número
 * puro (@s.whatsapp.net) o envio volta com status ERROR e o lead NÃO recebe.
 * O webhook de inbound NÃO traz o @lid de forma confiável (às vezes vem só o
 * número), então resolvemos pelo histórico: pega o último inbound do contato
 * (filtrando key.remoteJidAlt = número, fromMe=false) e devolve o key.remoteJid
 * (que é o @lid). Retorna null se não achar (contato não migrado → usa número).
 */
export async function resolverLidPorNumero(
  instance: string,
  telefone: string,
): Promise<string | null> {
  let url: string, key: string;
  try {
    ({ url, key } = config());
  } catch {
    return null;
  }
  const num = soDigitos(telefone);
  if (!num) return null;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(`${url}/chat/findMessages/${instance}`, {
      method: "POST",
      headers: { apikey: key, "Content-Type": "application/json" },
      body: JSON.stringify({
        where: { key: { remoteJidAlt: `${num}@s.whatsapp.net`, fromMe: false } },
        limit: 1,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (!res.ok) return null;
    const data = (await res.json()) as {
      messages?: { records?: Array<{ key?: { remoteJid?: string } }> };
    };
    const jid = data?.messages?.records?.[0]?.key?.remoteJid ?? "";
    return jid.endsWith("@lid") ? jid : null;
  } catch {
    clearTimeout(timeoutId);
    return null;
  }
}

/**
 * Status normalizado de um envio (consulta a Evolution pelo key.id):
 * - "ERROR": a sessão NÃO conseguiu mandar pra esse destino (formato @lid/número
 *   errado pra sessão atual, contato dessincronizado). Tentar outro destino.
 * - "OK": SERVER_ACK ou além — o WhatsApp aceitou (entrega quando o destino voltar).
 * - "PENDING": ainda na fila (status não assentou).
 */
async function statusMensagem(
  instance: string,
  msgId: string,
): Promise<"ERROR" | "OK" | "PENDING" | null> {
  let url: string, key: string;
  try {
    ({ url, key } = config());
  } catch {
    return null;
  }
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(`${url}/chat/findMessages/${instance}`, {
      method: "POST",
      headers: { apikey: key, "Content-Type": "application/json" },
      body: JSON.stringify({ where: { key: { id: msgId } }, limit: 1 }),
      signal: controller.signal,
    });
    clearTimeout(t);
    if (!res.ok) return null;
    const data = (await res.json()) as {
      messages?: { records?: Array<{ MessageUpdate?: Array<{ status?: string }> }> };
    };
    const sts = (data?.messages?.records?.[0]?.MessageUpdate ?? []).map((u) => u.status);
    if (sts.includes("ERROR")) return "ERROR";
    if (sts.some((s) => s && ["SERVER_ACK", "DELIVERY_ACK", "READ", "PLAYED"].includes(s)))
      return "OK";
    return "PENDING";
  } catch {
    clearTimeout(t);
    return null;
  }
}

/**
 * Espera um envio ser ACEITO ou falhar. Poll de ~6s: ERROR → false (quem chama
 * tenta outro destino), SERVER_ACK+ → true. Se ficar só PENDING (destinatário
 * offline, mas sessão ok) também conta como aceito — vai entregar quando voltar.
 * É o que permite tentar @lid e número até achar o que a sessão da instância aceita
 * (isso INVERTE quando a instância re-linka via QR).
 */
export async function aguardarAceite(instance: string, msgId: string): Promise<boolean> {
  const sid = msgId.slice(0, 8);
  let ultimo = "?";
  for (let i = 0; i < 6; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const st = await statusMensagem(instance, msgId);
    ultimo = st ?? "null";
    if (st === "ERROR") { console.log(`[T:aceite] ${instance} id=${sid} => ERROR (${i + 1}s)`); return false; }
    if (st === "OK") { console.log(`[T:aceite] ${instance} id=${sid} => OK/aceito (${i + 1}s)`); return true; }
  }
  console.log(`[T:aceite] ${instance} id=${sid} => PENDING(${ultimo}) 6s, tratado como aceito`);
  return true; // PENDING sem ERROR em 6s → aceito
}

export async function evoSendText(opts: {
  instance: string;
  telefone: string;
  texto: string;
}): Promise<{ id: string } | { error: string }> {
  return postEvolution(opts.instance, "sendText", {
    number: resolverDestino(opts.telefone),
    text: opts.texto,
  });
}

/**
 * Mostra "digitando..." (composing) ou "gravando áudio..." (recording) pro lead.
 * Fire-and-forget — se falhar, não atrapalha o envio. O `delay` (ms) é quanto a
 * Evolution mantém o status. Endpoint /chat/sendPresence.
 */
export async function evoSendPresence(opts: {
  instance: string;
  telefone: string;
  presence: "composing" | "recording" | "paused" | "available";
  delayMs?: number;
}): Promise<{ id: string } | { error: string }> {
  return postEvolution(
    opts.instance,
    "sendPresence",
    { number: resolverDestino(opts.telefone), presence: opts.presence, delay: opts.delayMs ?? 0 },
    "chat",
  );
}

export async function evoSendAudio(opts: {
  instance: string;
  telefone: string;
  audioBase64: string;
}): Promise<{ id: string } | { error: string }> {
  return postEvolution(opts.instance, "sendWhatsAppAudio", {
    number: resolverDestino(opts.telefone),
    audio: opts.audioBase64,
  });
}

export async function evoSendMedia(opts: {
  instance: string;
  telefone: string;
  media: string;
  mediatype: "image" | "video" | "document";
  mimetype?: string;
  caption?: string;
  fileName?: string;
}): Promise<{ id: string } | { error: string }> {
  return postEvolution(opts.instance, "sendMedia", {
    number: resolverDestino(opts.telefone),
    mediatype: opts.mediatype,
    mimetype: opts.mimetype,
    media: opts.media,
    caption: opts.caption,
    fileName: opts.fileName,
  });
}
