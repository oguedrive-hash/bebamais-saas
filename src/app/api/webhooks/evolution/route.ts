/**
 * Webhook da Evolution (F3). EVOLUTION_RECEBE != "1": observa. ="1": processa
 * texto E áudio (transcreve via Whisper), acha/cria lead por telefone, salva e
 * dispara o Caio. Cutover = flag on + guard no webhook Chatwoot.
 */
import { NextResponse, type NextRequest, after } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { agendarRespostaCaioComDebounce } from "../chatwoot/route";
import { salvarAudioBase64 } from "@/lib/caio/storage-audio";
import { gerarRespostaCaio } from "@/lib/caio/gerar-resposta";
import { enviarMensagem } from "@/lib/caio/chatwoot-api";
import { evoConnectionState } from "@/lib/caio/evolution-api";
import { ehInboundAquecimento } from "@/lib/caio/aquecimento";

const ORG_ID = process.env.DEFAULT_ORG_ID ?? "455b9a80-6bb9-461b-b62d-188f0a28c110"; // Facilita (fallback)

type EvoKey = { remoteJid?: string; remoteJidAlt?: string; addressingMode?: string; fromMe?: boolean; id?: string };
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
  // A mídia NEM SEMPRE está pronta no instante que o webhook chega (a Evolution
  // ainda baixa/descriptografa do WhatsApp) → o getBase64 dá 4xx transitório e o
  // áudio "some". Tenta algumas vezes com backoff curto antes de desistir.
  for (let i = 0; i < 4; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, 1500));
    try {
      const res = await fetch(url + "/chat/getBase64FromMediaMessage/" + instance, {
        method: "POST",
        headers: { apikey, "Content-Type": "application/json" },
        body: JSON.stringify({ message: { key } }),
      });
      if (res.ok) {
        const data = (await res.json()) as { base64?: string };
        if (data.base64) return data.base64;
        console.warn(`[evo:audio] getBase64 ok mas sem base64 (tentativa ${i + 1}/4)`);
      } else {
        const t = await res.text();
        console.warn(`[evo:audio] getBase64 http ${res.status} (tentativa ${i + 1}/4): ${t.slice(0, 150)}`);
      }
    } catch (e) {
      console.warn(`[evo:audio] getBase64 erro (tentativa ${i + 1}/4):`, e instanceof Error ? e.message : e);
    }
  }
  return null;
}

async function transcrever(audioBase64: string): Promise<string | null> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    console.warn("[evo:audio] transcrever: OPENAI_API_KEY não definida");
    return null;
  }
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
    if (!res.ok) {
      const t = await res.text();
      console.warn(`[evo:audio] whisper http ${res.status}: ${t.slice(0, 200)}`);
      return null;
    }
    const data = (await res.json()) as { text?: string };
    return data.text ? data.text.trim() : null;
  } catch (e) {
    console.warn("[evo:audio] whisper erro:", e instanceof Error ? e.message : e);
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

  // FAILOVER: evento de conexão (não tem key/mensagem). Se um número de atendimento
  // CAIU (state close), um número saudável do pool assume os leads em conversa e se
  // apresenta dando continuidade. Quando volta (open), só remarca conectado.
  if (body.event === "connection.update" || body.event === "CONNECTION_UPDATE") {
    const estado = (body.data as unknown as { state?: string } | undefined)?.state ?? "";
    const inst = body.instance ?? "";
    console.log("[evo:conn]", inst, "state=", estado);
    if ((estado === "close" || estado === "DISCONNECTED") && inst) {
      after(() => tratarQuedaNumero(inst).catch((e) => console.error("[failover] erro:", e)));
    } else if (estado === "open" && inst) {
      // Reconectou: remarca conectado e, se estava `caido`, volta pra `ativo`
      // (fica disponível de novo no pool). NÃO rouba os leads de volta — a conversa
      // segue com quem assumiu. `standby` (backup) NÃO é promovido aqui.
      try {
        const admin = createAdminClient();
        await admin.from("org_numeros").update({ status_conexao: "open" }).eq("instance_name", inst);
        await admin.from("org_numeros").update({ estado: "ativo" }).eq("instance_name", inst).eq("estado", "caido");
      } catch { /* best-effort */ }
    }
    return NextResponse.json({ ok: true });
  }

  const rjid = d?.key?.remoteJid ?? "";
  const rjidAlt = d?.key?.remoteJidAlt ?? "";
  const fromMe = d?.key?.fromMe ?? false;
  // O inbound traz o LID (@lid) e o número (@s.whatsapp.net). Identifica o lead pelo
  // NÚMERO real; guarda o @lid pra RESPONDER por ele (entrega a quem migrou pro LID —
  // enviar pro número puro fica PENDING e não chega).
  const numeroJid = [rjid, rjidAlt].find((j) => j.endsWith("@s.whatsapp.net")) ?? rjid;
  const lidJid = [rjid, rjidAlt].find((j) => j.endsWith("@lid")) ?? "";
  const telefone = numeroJid.replace(/@.*/, "").replace(/[^0-9]/g, "");
  const instance = body.instance ?? process.env.DEFAULT_INSTANCE_NAME ?? "facilita";

  if (process.env.EVOLUTION_RECEBE !== "1" || fromMe || !telefone) {
    console.log("[evo:webhook]", process.env.EVOLUTION_RECEBE === "1" ? "skip" : "obs", JSON.stringify({ rjid, rjidAlt, lidJid, fromMe, tipo: d?.messageType }));
    return NextResponse.json({ ok: true });
  }

  // Dedup: a Evolution RE-ENTREGA o webhook se não receber 200 rápido. Sem isto a
  // mesma mensagem era processada várias vezes (duplicava no painel + Caio em loop).
  if (jaProcessado(d?.key?.id)) {
    console.log("[evo:webhook] duplicado, ignorando", d?.key?.id);
    return NextResponse.json({ ok: true });
  }
  // Responde 200 NA HORA e processa em segundo plano. O processamento é longo
  // (transcrição Whisper + debounce 10-18s + digitação 60s+ + envio); segurar a
  // resposta fazia a Evolution achar que falhou e re-entregar — causa do loop.
  after(() =>
    processarEvolution(d, telefone, instance, lidJid).catch((e) =>
      console.error("[evo:webhook] erro bg:", e),
    ),
  );
  return NextResponse.json({ ok: true });
}

// Dedup em memória — guarda os IDs de mensagem já vistos (limpa quando passa de 500).
const processados = new Set<string>();
function jaProcessado(id: string | undefined): boolean {
  if (!id) return false;
  if (processados.has(id)) return true;
  processados.add(id);
  if (processados.size > 500) {
    const arr = [...processados];
    processados.clear();
    arr.slice(-200).forEach((x) => processados.add(x));
  }
  return false;
}

/**
 * FAILOVER do pool: um número de atendimento caiu (state close). Um número
 * saudável do pool ASSUME os leads que estavam `em_conversa` nele, se apresenta
 * dando continuidade (com o contexto do histórico, que vive no banco) e segue o
 * atendimento. Só pega leads EM CONVERSA (não os frios) — pra não queimar o
 * número que assume. A persona/voz passa a ser a do número novo.
 */
async function tratarQuedaNumero(instanceCaido: string): Promise<void> {
  const admin = createAdminClient();
  const { data: caido } = await admin
    .from("org_numeros")
    .select("id, organization_id, persona_nome")
    .eq("instance_name", instanceCaido)
    .maybeSingle();
  if (!caido) {
    console.log("[failover] instância fora do pool:", instanceCaido);
    return;
  }
  const orgId = (caido as { organization_id: string }).organization_id;
  const caidoId = (caido as { id: string }).id;
  const nomeAntigo = (caido as { persona_nome?: string | null }).persona_nome || "o atendente anterior";

  // Confirma a queda (evita falso positivo de um "close" momentâneo): re-checa.
  const estadoReal = await evoConnectionState(instanceCaido);
  if (estadoReal === "open") {
    console.log("[failover] reconectou rápido, aborta:", instanceCaido);
    await admin.from("org_numeros").update({ estado: "ativo", status_conexao: "open" }).eq("id", caidoId);
    return;
  }
  await admin.from("org_numeros").update({ estado: "caido", status_conexao: "close" }).eq("id", caidoId);

  // Leads EM CONVERSA servidos pelo número caído.
  const { data: leads } = await admin
    .from("leads")
    .select("id, nome, chatwoot_conversation_id")
    .eq("organization_id", orgId)
    .eq("evolution_instance", instanceCaido)
    .eq("status", "em_conversa")
    .eq("caio_ativo", true);
  if (!leads?.length) {
    console.log("[failover] sem leads em conversa em", instanceCaido);
    return;
  }

  // Quem ASSUME: outro número do pool, ativo + ia_ativa, != caído, CONECTADO,
  // por prioridade (menor primeiro). Pula prospecção.
  const { data: cands } = await admin
    .from("org_numeros")
    .select("instance_name, persona_nome, prioridade")
    .eq("organization_id", orgId)
    .eq("ativo", true)
    .eq("ia_ativa", true)
    .neq("instance_name", instanceCaido)
    .in("papel", ["atendimento", "backup"])
    .order("prioridade", { ascending: true });
  let assumiu: { instance_name: string; persona_nome: string | null } | null = null;
  for (const c of cands ?? []) {
    const inst = (c as { instance_name: string }).instance_name;
    if ((await evoConnectionState(inst)) === "open") {
      assumiu = c as { instance_name: string; persona_nome: string | null };
      break;
    }
  }
  if (!assumiu) {
    console.log("[failover] nenhum número saudável pra assumir os leads de", instanceCaido);
    return;
  }
  const nomeNovo = assumiu.persona_nome || "nosso atendente";

  // Promove quem assumiu (backup standby -> ativo).
  await admin
    .from("org_numeros")
    .update({ estado: "ativo", status_conexao: "open" })
    .eq("instance_name", assumiu.instance_name)
    .eq("organization_id", orgId);

  console.log(`[failover] ${instanceCaido} (${nomeAntigo}) caiu -> ${assumiu.instance_name} (${nomeNovo}) assume ${leads.length} lead(s)`);

  for (const l of leads) {
    const leadId = (l as { id: string }).id;
    const convId = (l as { chatwoot_conversation_id: number }).chatwoot_conversation_id;
    // Reassocia o lead ao número que assumiu (persona/voz passam a ser dele).
    await admin.from("leads").update({ evolution_instance: assumiu.instance_name }).eq("id", leadId);
    // Mensagem de assunção (com o contexto do histórico) gerada pelo LLM e enviada
    // pelo número novo. promptBaseOverride troca o roteiro só por esta mensagem.
    const override = `Voce e ${nomeNovo}, atendente da empresa. Voce esta ASSUMINDO AGORA este atendimento, que estava com ${nomeAntigo} (a conexao do WhatsApp dele caiu). O historico da conversa esta acima. Envie UMA mensagem curta e natural: cumprimente a pessoa pelo nome, avise de forma leve que vai continuar o atendimento no lugar do ${nomeAntigo}, VALIDE um ponto CONCRETO que ela ja falou na conversa (use SOMENTE o historico, nunca invente) e faca a proxima pergunta pra seguir de onde parou. Ex: "Oi Lucas, aqui e a ${nomeNovo}! O ${nomeAntigo} precisou dar uma saida e ja peguei seu atendimento daqui. Vi que voce comentou que tem 5 funcionarios — me conta, ...?". 1-2 frases, no maximo uma pergunta. Tom natural, sem parecer robo. PROIBIDO emoji.`;
    const result = await gerarRespostaCaio({ leadId, promptBaseOverride: override });
    if ("error" in result) {
      console.error("[failover] gerar msg falhou p/ lead", leadId, result.error);
      continue;
    }
    const sent = await enviarMensagem({
      conversationId: convId,
      content: result.resposta,
      instanceOverride: assumiu.instance_name,
    });
    if ("error" in sent) console.error("[failover] envio falhou p/ lead", leadId, (sent as { error: string }).error);
    else console.log("[failover]", nomeNovo, "assumiu lead", leadId);
  }
}

async function processarEvolution(
  d: EvoData | undefined,
  telefone: string,
  instance: string,
  lidJid: string,
): Promise<void> {
  console.log(`[T:inbound] tel=${telefone} inst=${instance} lid=${lidJid || "-"} tipo=${d?.messageType ?? "?"}`);
  // Lookup do número no pool (uma vez) — usado pro filtro de AQUECIMENTO e pro test-mode.
  let cfgNum:
    | { ia_ativa?: boolean; numeros_teste?: string | null; persona_nome?: string }
    | null = null;
  try {
    const admin0 = createAdminClient();
    const { data } = await admin0
      .from("org_numeros")
      .select("ia_ativa, numeros_teste, persona_nome")
      .eq("instance_name", instance)
      .maybeSingle();
    cfgNum =
      (data as {
        ia_ativa?: boolean;
        numeros_teste?: string | null;
        persona_nome?: string;
      } | null) ?? null;
  } catch (e) {
    console.warn("[T:filtro] erro no lookup do número:", e);
  }

  // AQUECIMENTO: se o inbound é tráfego de maturação (remetente é número do aquecedor,
  // ou receptor é número puro de warmup), NÃO dispara o Caio — viabiliza o esquema duplo
  // (mesmo número atende lead E aquece). Sem isto, msg de âncora vira "lead" e dá loop.
  if (
    await ehInboundAquecimento({
      organizationId: ORG_ID,
      instanceReceptor: instance,
      numeroRemetente: telefone,
      receptorAtendeLead: !!cfgNum,
    })
  ) {
    console.log(`[T:aquecimento] inbound de aquecimento (de ${telefone} pra ${instance}) — pula o Caio`);
    return;
  }

  // Filtro por número do pool: respeita o toggle da IA (ia_ativa) e a whitelist de
  // teste (numeros_teste). Protege números de uso MANUAL (ex: cobrança de cliente) —
  // a IA não responde se estiver desligada, e em modo teste só responde os autorizados.
  if (cfgNum) {
    if (cfgNum.ia_ativa === false) {
      console.log(`[T:filtro] BLOQUEADO: IA desligada em ${instance} — não responde`);
      return;
    }
    const wl = (cfgNum.numeros_teste ?? "")
      .split(/[\s,;]+/)
      .map((s) => s.replace(/\D/g, ""))
      .filter(Boolean);
    if (wl.length > 0) {
      const tel = telefone.replace(/\D/g, "");
      const ok = wl.some((w) => tel.endsWith(w) || w.endsWith(tel));
      if (!ok) {
        console.log(`[T:filtro] BLOQUEADO: ${telefone} fora da whitelist [${wl.join(",")}] de ${instance} (${cfgNum.persona_nome ?? "?"}) — não responde`);
        return;
      }
      console.log(`[T:filtro] OK: ${telefone} na whitelist de teste de ${instance}`);
    } else {
      console.log(`[T:filtro] OK: ${instance} sem whitelist (responde todos)`);
    }
  } else {
    console.log(`[T:filtro] instância ${instance} fora do pool org_numeros — segue sem filtro`);
  }

  let texto: string | null = d?.message?.conversation ?? d?.message?.extendedTextMessage?.text ?? null;
  let tipo = "texto";
  let attachmentUrl: string | null = null;
  if (!texto && d?.message?.audioMessage) {
    const b64 = await getAudioBase64(instance, d.key);
    const t = b64 ? await transcrever(b64) : null;
    if (t) {
      texto = t;
      tipo = "audio";
      // Guarda o arquivo de áudio no Storage pra o painel poder TOCAR (não só a transcrição)
      if (b64) attachmentUrl = await salvarAudioBase64(b64, "ogg", "audio/ogg");
      console.log("[evo:webhook] audio transcrito:", t.slice(0, 60));
    } else {
      console.error("[evo:webhook] falha ao transcrever audio");
    }
  }
  if (!texto) {
    console.log("[evo:webhook] sem texto/audio aproveitavel", d?.messageType);
    return;
  }

  try {
    const admin = createAdminClient();
    const { data: leads } = await admin
      .from("leads")
      .select("id, evolution_instance")
      .eq("organization_id", ORG_ID)
      .eq("telefone_digitos", telefone)
      .limit(1);
    const leadExistente = leads?.[0] as { id?: string; evolution_instance?: string | null } | undefined;
    let leadId = leadExistente?.id as string | undefined;
    // Instância que servia o lead ANTES desse inbound (pra detectar troca de número).
    const instAntiga = leadExistente?.evolution_instance ?? null;
    if (!leadId) {
      const { data: novo } = await admin
        .from("leads")
        .insert({ organization_id: ORG_ID, telefone: "+" + telefone, telefone_digitos: telefone, nome: d?.pushName ?? null, status: "novo_lead", origem: "inbound", source: "whatsapp", caio_ativo: true, whatsapp_jid: lidJid || null, chatwoot_conversation_id: Math.floor(Math.random() * 2000000000) })
        .select("id")
        .single();
      leadId = novo?.id as string | undefined;
    }
    if (!leadId) {
      console.error("[evo:webhook] sem leadId");
      return;
    }
    console.log(`[T:lead] ${leadExistente ? "existente" : "NOVO"} id=${leadId} servindo: ${instAntiga || "-"} -> ${instance}${instAntiga && instAntiga !== instance ? " (TROCA detectada)" : ""}`);
    await admin.from("mensagens").insert({ organization_id: ORG_ID, lead_id: leadId, direcao: "entrada", tipo, conteudo: texto, attachment_url: attachmentUrl });
    // Lead respondeu -> zera cadencias e reengaja (replica o que o webhook do Chatwoot fazia)
    const agora = new Date().toISOString();
    // Fase 1 pool: carimba o número que RECEBEU o inbound como o que serve o lead
    // (assim a resposta sai pelo mesmo número). Com 1 número, é sempre "facilita".
    const updReengaja: Record<string, unknown> = { numero_followup: 0, numero_reativacao: 0, numero_prospeccao: 0, proximo_followup_em: null, ultima_msg_lead_em: agora, evolution_instance: instance };
    if (lidJid) updReengaja.whatsapp_jid = lidJid; // captura/atualiza o @lid em leads que já existiam
    // Troca de atendente/número: o lead vinha servido por OUTRA instância e agora
    // escreveu por esta. Marca a anterior pra a persona nova RECONHECER a continuação
    // ("vamos continuar por aqui, lá com o Caio você disse X?") na resposta. A flag é
    // consumida (limpa) quando a resposta a usa. Só marca em troca real (anterior != atual).
    if (instAntiga && instAntiga !== instance) updReengaja.instancia_anterior = instAntiga;
    await admin.from("leads").update(updReengaja).eq("id", leadId);
    await admin.from("leads").update({ proximo_contato_em: null, status: "em_conversa", origem: "inbound" }).eq("id", leadId).in("status", ["perdido", "fechou"]);
    await admin.from("leads").update({ proximo_contato_em: null, status: "em_conversa" }).eq("id", leadId).eq("origem", "prospeccao").in("status", ["aguardando_primeiro_contato", "em_prospeccao"]);
    await admin.from("leads").update({ status: "em_conversa" }).eq("id", leadId).eq("status", "novo_lead");
    await agendarRespostaCaioComDebounce(admin, ORG_ID, leadId);
    console.log("[evo:webhook] processou lead", leadId, "tipo", tipo);
  } catch (e) {
    console.error("[evo:webhook] erro:", e);
  }
}
