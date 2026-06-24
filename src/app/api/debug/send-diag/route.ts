/**
 * Diagnóstico de ENVIO — isola a camada Evolution/WhatsApp do nosso roteamento
 * (failover / resiliente / modo-teste). Manda o MESMO texto pelo `instance` para
 * um número, testando os 3 formatos de destino, e devolve o STATUS REAL de cada um
 * (ERROR / SERVER_ACK / DELIVERY_ACK / READ / PENDING).
 *
 *   POST /api/debug/send-diag
 *   Authorization: Bearer <CRON_SECRET>
 *   { "instance": "facilita", "number": "5519998744971", "texto": "diag" }
 */
import { NextResponse, type NextRequest } from "next/server";

function cfg() {
  const url = (process.env.EVOLUTION_API_URL ?? "").trim().replace(/\/+$/, "");
  const key = (process.env.EVOLUTION_API_KEY ?? "").trim();
  return { url, key };
}

async function evoPost(url: string, key: string, rota: string, body: unknown) {
  const res = await fetch(`${url}/${rota}`, {
    method: "POST",
    headers: { apikey: key, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { http: res.status, json: j };
}

async function statusDe(url: string, key: string, instance: string, id: string): Promise<string[]> {
  const { json } = await evoPost(url, key, `chat/findMessages/${instance}`, { where: { key: { id } }, limit: 1 });
  const recs = (json as { messages?: { records?: Array<{ MessageUpdate?: Array<{ status?: string }> }> } })?.messages?.records;
  const ups = recs?.[0]?.MessageUpdate ?? [];
  return ups.map((u) => u.status).filter((s): s is string => !!s);
}

async function resolverLid(url: string, key: string, instance: string, num: string): Promise<string | null> {
  const { json } = await evoPost(url, key, `chat/findMessages/${instance}`, {
    where: { key: { remoteJidAlt: `${num}@s.whatsapp.net`, fromMe: false } },
    limit: 1,
  });
  const recs = (json as { messages?: { records?: Array<{ key?: { remoteJid?: string } }> } })?.messages?.records;
  const jid = recs?.[0]?.key?.remoteJid ?? "";
  return jid.endsWith("@lid") ? jid : null;
}

export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET não configurado" }, { status: 500 });
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { instance?: string; number?: string; texto?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "json inválido" }, { status: 400 });
  }
  const { instance } = body;
  const texto = body.texto ?? "diag";
  const num = (body.number ?? "").replace(/\D/g, "");
  if (!instance || !num) return NextResponse.json({ error: "instance e number obrigatórios" }, { status: 400 });

  const { url, key } = cfg();
  if (!url || !key) return NextResponse.json({ error: "EVOLUTION env ausente" }, { status: 500 });

  const lid = await resolverLid(url, key, instance, num);
  const destinos: { fmt: string; dest: string }[] = [
    ...(lid ? [{ fmt: "lid", dest: lid }] : []),
    { fmt: "numero@swn", dest: `${num}@s.whatsapp.net` },
    { fmt: "soDigitos", dest: num },
  ];

  const resultados: unknown[] = [];
  for (const d of destinos) {
    const { http, json } = await evoPost(url, key, `message/sendText/${instance}`, { number: d.dest, text: `${texto} [${d.fmt}]` });
    const id = (json as { key?: { id?: string } })?.key?.id ?? null;
    const statusImediato = (json as { status?: string })?.status ?? null;
    let statusFinal: string[] = [];
    if (id) {
      for (let i = 0; i < 8; i++) {
        await new Promise((r) => setTimeout(r, 1000));
        statusFinal = await statusDe(url, key, instance, id);
        if (statusFinal.includes("ERROR") || statusFinal.some((s) => ["SERVER_ACK", "DELIVERY_ACK", "READ"].includes(s))) break;
      }
    }
    resultados.push({ formato: d.fmt, destino: d.dest, http, idEnvio: id, statusImediato, statusFinal, erroEvolution: id ? null : json });
  }

  return NextResponse.json({ instance, number: num, lidResolvido: lid, resultados });
}
