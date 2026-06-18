/**
 * Webhook da Evolution (F3). EVOLUTION_RECEBE != "1": observa. ="1": processa
 * texto E áudio (transcreve via Whisper), acha/cria lead por telefone, salva e
 * dispara o Caio. Cutover = flag on + guard no webhook Chatwoot.
 */
import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { agendarRespostaCaioComDebounce } from "../chatwoot/route";

const ORG_ID = "455b9a80-6bb9-461b-b62d-188f0a28c110"; // Facilita

type EvoKey = { remoteJid?: string; fromMe?: boolean; id?: string };
type EvoData = {
  key?: EvoKey;
  pushName?: string;
  message?: {
    conversation?: string;
    extendedTextMessage?: { text?: string };
    audioMessage?: unknown;
  };
  messageType?: string;
};

async function getAudioBase64(instance: string, key: EvoKey | undefined): Promise<string | null> {
  const url = (process.env.EVOLUTION_API_URL ?? "").replace(/\/+$/, "");
  const apikey = process.env.EVOLUTION_API_KEY ?? "";
  if (!url || !apikey || !key) return null;
  try {
    const res = await fetch(url + "/chat/getBase64FromMediaMessage/" + instance, {
      method: "POST",
      headers: { apikey, "Content-Type": "application/json" },
      body: JSON.stringify({ message: { key } }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { base64?: string };
    return data.base64 ?? null;
  } catch {
    return null;
  }
}

async function transcrever(audioBase64: string): Promise<string | null> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  try {
    const buf = Buffer.from(audioBase64, "base64");
    const file = new File([buf], "audio.ogg", { type: "audio/ogg" });
    const form = new FormData();
    form.set("file", file);
    form.set("model", process.env.OPENAI_WHISPER_MODEL ?? "whisper-1");
    form.set("language", "pt");
    const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: "Bearer " + key },
      body: form,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { text?: string };
    return data.text ? data.text.trim() : null;
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  let body: { event?: string; instance?: string; data?: EvoData };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  const d = body.data;
  const remoteJid = d?.key?.remoteJid ?? "";
  const fromMe = d?.key?.fromMe ?? false;
  const telefone = remoteJid.replace(/@.*/, "").replace(/[^0-9]/g, "");
  const instance = body.instance ?? "facilita";

  if (process.env.EVOLUTION_RECEBE !== "1" || fromMe || !telefone) {
    console.log("[evo:webhook]", process.env.EVOLUTION_RECEBE === "1" ? "skip" : "obs", JSON.stringify({ remoteJid, fromMe, tipo: d?.messageType }));
    return NextResponse.json({ ok: true });
  }

  let texto: string | null = d?.message?.conversation ?? d?.message?.extendedTextMessage?.text ?? null;
  let tipo = "texto";
  if (!texto && d?.message?.audioMessage) {
    const b64 = await getAudioBase64(instance, d.key);
    const t = b64 ? await transcrever(b64) : null;
    if (t) {
      texto = t;
      tipo = "audio";
      console.log("[evo:webhook] audio transcrito:", t.slice(0, 60));
    } else {
      console.error("[evo:webhook] falha ao transcrever audio");
    }
  }
  if (!texto) {
    console.log("[evo:webhook] sem texto/audio aproveitavel", d?.messageType);
    return NextResponse.json({ ok: true });
  }

  try {
    const admin = createAdminClient();
    const { data: leads } = await admin
      .from("leads")
      .select("id")
      .eq("organization_id", ORG_ID)
      .eq("telefone_digitos", telefone)
      .limit(1);
    let leadId = leads?.[0]?.id as string | undefined;
    if (!leadId) {
      const { data: novo } = await admin
        .from("leads")
        .insert({ organization_id: ORG_ID, telefone: "+" + telefone, telefone_digitos: telefone, nome: d?.pushName ?? null, status: "novo_lead", origem: "inbound", source: "whatsapp", caio_ativo: true, chatwoot_conversation_id: Math.floor(Math.random() * 2000000000) })
        .select("id")
        .single();
      leadId = novo?.id as string | undefined;
    }
    if (!leadId) {
      console.error("[evo:webhook] sem leadId");
      return NextResponse.json({ ok: false });
    }
    await admin.from("mensagens").insert({ organization_id: ORG_ID, lead_id: leadId, direcao: "entrada", tipo, conteudo: texto });
    // Lead respondeu -> zera cadencias e reengaja (replica o que o webhook do Chatwoot fazia)
    const agora = new Date().toISOString();
    await admin.from("leads").update({ numero_followup: 0, numero_reativacao: 0, numero_prospeccao: 0, proximo_followup_em: null, ultima_msg_lead_em: agora }).eq("id", leadId);
    await admin.from("leads").update({ proximo_contato_em: null, status: "em_conversa", origem: "inbound" }).eq("id", leadId).in("status", ["perdido", "fechou"]);
    await admin.from("leads").update({ proximo_contato_em: null, status: "em_conversa" }).eq("id", leadId).eq("origem", "prospeccao").in("status", ["aguardando_primeiro_contato", "em_prospeccao"]);
    await admin.from("leads").update({ status: "em_conversa" }).eq("id", leadId).eq("status", "novo_lead");
    await agendarRespostaCaioComDebounce(admin, ORG_ID, leadId);
    console.log("[evo:webhook] processou lead", leadId, "tipo", tipo);
  } catch (e) {
    console.error("[evo:webhook] erro:", e);
  }
  return NextResponse.json({ ok: true });
}
