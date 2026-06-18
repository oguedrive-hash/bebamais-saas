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
    number: soDigitos(opts.telefone),
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
    { number: soDigitos(opts.telefone), presence: opts.presence, delay: opts.delayMs ?? 0 },
    "chat",
  );
}

export async function evoSendAudio(opts: {
  instance: string;
  telefone: string;
  audioBase64: string;
}): Promise<{ id: string } | { error: string }> {
  return postEvolution(opts.instance, "sendWhatsAppAudio", {
    number: soDigitos(opts.telefone),
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
    number: soDigitos(opts.telefone),
    mediatype: opts.mediatype,
    mimetype: opts.mimetype,
    media: opts.media,
    caption: opts.caption,
    fileName: opts.fileName,
  });
}
