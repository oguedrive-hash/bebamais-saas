/**
 * Gestão de INSTÂNCIAS na Evolution (criar / QR / deletar) — usado pelo painel
 * (Fase 2 do pool de números, ver conhecimento/arquitetura-pool-numeros.md).
 * Server-side. Separado de `evolution-api.ts` (que cuida de ENVIO) de propósito,
 * pra não mexer na guarda anti-hammer. Estado de conexão segue em `evoConnectionState`.
 */

function cfg(): { url: string; key: string } | { error: string } {
  const url = (process.env.EVOLUTION_API_URL ?? "").trim().replace(/\/+$/, "");
  const key = (process.env.EVOLUTION_API_KEY ?? "").trim();
  if (!url || !key) return { error: "EVOLUTION_API_URL/KEY não definidas" };
  return { url, key };
}

async function req(
  metodo: "GET" | "POST" | "DELETE",
  rota: string,
  body?: unknown,
): Promise<{ ok: true; data: unknown } | { error: string }> {
  const c = cfg();
  if ("error" in c) return c;
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch(`${c.url}${rota}`, {
      method: metodo,
      headers: { apikey: c.key, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    clearTimeout(t);
    const txt = await res.text();
    let data: unknown = null;
    try {
      data = txt ? JSON.parse(txt) : null;
    } catch {
      data = txt;
    }
    if (!res.ok) return { error: `Evolution ${res.status}: ${txt.slice(0, 200)}` };
    return { ok: true, data };
  } catch (e) {
    clearTimeout(t);
    if (e instanceof Error && e.name === "AbortError")
      return { error: "Evolution timeout" };
    return { error: e instanceof Error ? e.message : "fetch falhou" };
  }
}

const WEBHOOK_URL = "https://app.facilitaplus.com.br/api/webhooks/evolution";

/** Configura o webhook da instância (MESSAGES_UPSERT → painel). SEM isto o número
 * novo NÃO recebe inbound (o painel nem fica sabendo que falaram com ele). */
export async function evoConfigurarWebhook(
  instance: string,
): Promise<{ ok: true } | { error: string }> {
  const r = await req("POST", `/webhook/set/${instance}`, {
    webhook: {
      enabled: true,
      url: WEBHOOK_URL,
      events: ["MESSAGES_UPSERT"],
      webhookByEvents: false,
      webhookBase64: false,
    },
  });
  if ("error" in r) return r;
  return { ok: true };
}

/** Cria a instância na Evolution (idempotente: se já existe, segue em frente).
 * Já configura o webhook — senão o número novo não recebe inbound. */
export async function evoCriarInstancia(
  instanceName: string,
): Promise<{ ok: true } | { error: string }> {
  const r = await req("POST", "/instance/create", {
    instanceName,
    integration: "WHATSAPP-BAILEYS",
    qrcode: true,
  });
  if ("error" in r) {
    // "already in use"/"already exists" não é erro pra nós — a instância existe.
    if (/already|exists|in use/i.test(r.error)) {
      await evoConfigurarWebhook(instanceName); // garante o webhook mesmo se já existia
      return { ok: true };
    }
    return r;
  }
  await evoConfigurarWebhook(instanceName); // sem isto o número não recebe inbound
  return { ok: true };
}

/** Gera o QR (base64 PNG) + pairingCode pra conectar o número. */
export async function evoQrCode(
  instance: string,
): Promise<{ base64?: string; pairingCode?: string | null } | { error: string }> {
  const r = await req("GET", `/instance/connect/${instance}`);
  if ("error" in r) return r;
  const d = r.data as { base64?: string; pairingCode?: string | null };
  return { base64: d?.base64, pairingCode: d?.pairingCode ?? null };
}

/** Desloga e deleta a instância na Evolution (best-effort). */
export async function evoDeletarInstancia(
  instance: string,
): Promise<{ ok: true } | { error: string }> {
  await req("DELETE", `/instance/logout/${instance}`); // best-effort
  const r = await req("DELETE", `/instance/delete/${instance}`);
  if ("error" in r && !/not found|does not exist/i.test(r.error)) return r;
  return { ok: true };
}
