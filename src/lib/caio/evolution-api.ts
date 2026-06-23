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
