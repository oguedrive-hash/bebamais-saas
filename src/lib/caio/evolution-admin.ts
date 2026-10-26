/**
 * Gestão de INSTÂNCIAS na Evolution (criar / QR / deletar) — usado pelo painel
 * (Fase 2 do pool de números, ver conhecimento/arquitetura-pool-numeros.md).
 * Server-side. Separado de `evolution-api.ts` (que cuida de ENVIO) de propósito,
 * pra não mexer na guarda anti-hammer. Estado de conexão segue em `evoConnectionState`.
 */

import { APP_BASE_URL } from "@/lib/caio/config";

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

// O token na URL é o que autentica o webhook (a Evolution não assina as chamadas).
// Sem WEBHOOK_SECRET o webhook recusa tudo — ver src/lib/seguranca.ts.
// WEBHOOK_BASE_URL permite a Evolution chamar o painel pela rede interna do Docker.
const WEBHOOK_BASE = (process.env.WEBHOOK_BASE_URL?.trim() || APP_BASE_URL).replace(/\/+$/, "");
const WEBHOOK_URL = `${WEBHOOK_BASE}/api/webhooks/evolution?token=${encodeURIComponent(
  process.env.WEBHOOK_SECRET?.trim() ?? "",
)}`;

/** Configura o webhook da instância (MESSAGES_UPSERT + CONNECTION_UPDATE → painel).
 * MESSAGES_UPSERT: inbound do lead. CONNECTION_UPDATE: detecta queda do número
 * (failover do pool). SEM isto o número novo NÃO recebe inbound nem dispara failover. */
export async function evoConfigurarWebhook(
  instance: string,
): Promise<{ ok: true } | { error: string }> {
  const r = await req("POST", `/webhook/set/${instance}`, {
    webhook: {
      enabled: true,
      url: WEBHOOK_URL,
      events: ["MESSAGES_UPSERT", "CONNECTION_UPDATE"],
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

/**
 * Desconecta o WhatsApp (logout) sem apagar a instância: o número continua
 * cadastrado e volta a funcionar lendo o QR Code de novo. Já desconectado = ok.
 */
export async function evoDesconectar(
  instance: string,
): Promise<{ ok: true } | { error: string }> {
  const r = await req("DELETE", `/instance/logout/${instance}`);
  if ("error" in r && !/not connected|not open|close/i.test(r.error)) return r;
  return { ok: true };
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

/** Nome (assunto) de um grupo do WhatsApp, para a aba "Grupos". null se não conseguir. */
export async function evoNomeDoGrupo(instance: string, grupoJid: string): Promise<string | null> {
  const r = await req("GET", `/group/findGroupInfos/${instance}?groupJid=${encodeURIComponent(grupoJid)}`);
  if ("error" in r) return null;
  const nome = (r.data as { subject?: unknown } | null)?.subject;
  return typeof nome === "string" && nome.trim() ? nome.trim() : null;
}

/**
 * Cria a instância do APRENDIZADO: o WhatsApp da loja conectado só para LER
 * (ver src/lib/aprendizado/captura.ts). Mesmo modelo da iBrasileira.
 *
 * As configurações protegem o celular de quem atende: `readMessages:false`
 * (não marca nada como lido — a equipe continua vendo o que não respondeu),
 * `alwaysOnline:false` (não aparece "online" o tempo todo), `groupsIgnore`
 * (grupo não interessa) e `syncFullHistory` (traz as conversas antigas ao
 * conectar, para não precisar esperar dias de captura).
 */
export async function evoCriarInstanciaAprendizado(
  instanceName: string,
): Promise<{ ok: true } | { error: string }> {
  const configuracoes = {
    rejectCall: false,
    groupsIgnore: true,
    alwaysOnline: false,
    readMessages: false,
    readStatus: false,
    syncFullHistory: true,
  };
  const r = await req("POST", "/instance/create", {
    instanceName,
    integration: "WHATSAPP-BAILEYS",
    qrcode: true,
    ...configuracoes,
  });
  if ("error" in r && !/already|exists|in use/i.test(r.error)) return r;
  // De novo pelo endpoint próprio: garante as configurações mesmo se a
  // instância já existia ou se o create ignorou algum campo.
  await req("POST", `/settings/set/${instanceName}`, configuracoes);
  return evoConfigurarWebhook(instanceName);
}

/**
 * Uma página das mensagens que a Evolution guardou da instância (inclui o
 * histórico trazido na conexão). Devolve os registros crus e quantas páginas há.
 */
export async function evoBuscarMensagens(
  instance: string,
  pagina: number,
  porPagina = 200,
): Promise<{ registros: unknown[]; paginas: number } | { error: string }> {
  const r = await req("POST", `/chat/findMessages/${instance}`, {
    where: {},
    page: pagina,
    offset: porPagina,
  });
  if ("error" in r) return r;
  const d = r.data as
    | { messages?: { records?: unknown[]; pages?: number }; records?: unknown[]; pages?: number }
    | unknown[]
    | null;
  if (Array.isArray(d)) return { registros: d, paginas: 1 };
  const registros = d?.messages?.records ?? d?.records ?? [];
  const paginas = Number(d?.messages?.pages ?? d?.pages ?? 1) || 1;
  return { registros, paginas };
}
