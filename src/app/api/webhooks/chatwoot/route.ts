import { NextResponse, after, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { filterWebhook } from "@/lib/caio/filter";
import {
  resolveOrganization,
  getFacilitaOrgFallback,
} from "@/lib/caio/tenant";
import { gerarRespostaCaio } from "@/lib/caio/gerar-resposta";
import { classificarAceite } from "@/lib/caio/classificador-aceite";
import { classificarHandoff } from "@/lib/caio/classificador-handoff";
import { personaDoLead } from "@/lib/caio/numeros";
import { ehOptOut } from "@/lib/caio/guardrails";
import { dispararHandoff } from "@/lib/caio/handoff";
import { detectarDesqualificacao } from "@/lib/caio/detector-desqualificacao";
import { tentarAgendar } from "@/lib/caio/tentar-agendar";
import { notificarAdminFalha } from "@/lib/caio/notificar-admin";
import {
  descreverDiasNatural,
  tentarResponderDisponibilidade,
} from "@/lib/caio/resposta-disponibilidade";
import {
  AGENDA_CONFIG_DEFAULT,
  getAgendaConfig,
  janelaFuncionamento,
} from "@/lib/caio/agenda-config";
import { transcreverAudio } from "@/lib/caio/openai";
import { gerarAudio } from "@/lib/caio/elevenlabs";
import { classificarAdiamento } from "@/lib/caio/classificador-adiamento";
import { extrairEAtualizarPedido } from "@/lib/caio/extrator-pedido";
import {
  enviarMensagem,
  enviarMensagemComAudio,
  sinalizarPresenca,
} from "@/lib/caio/chatwoot-api";
import {
  normalizeMessageType,
  type ChatwootWebhook,
  type ChatwootWebhookMessageCreated,
  type ChatwootWebhookConversationUpdated,
  type ChatwootMessage,
  type ChatwootSender,
} from "@/lib/caio/types";

// Chatwoot 4.11 + WhatsApp/Evolution dispara principalmente
// `conversation_updated` (com `messages[]` aninhado), não message_created
// separado. Por isso o handler suporta ambos os formatos e dedupa pelo
// unique constraint em `chatwoot_message_id`.

export async function POST(request: NextRequest) {
  if (process.env.EVOLUTION_RECEBE === "1") return new Response(JSON.stringify({ ok: true, skip: "evolution" }), { status: 200, headers: { "content-type": "application/json" } });
  let webhook: ChatwootWebhook;
  try {
    webhook = (await request.json()) as ChatwootWebhook;
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  console.log("[caio:webhook]", {
    event: webhook.event,
    ts: new Date().toISOString(),
  });

  const decision = filterWebhook(webhook, []);
  if (decision.action === "ignore") {
    console.log("[caio:filter]", "ignore:", decision.reason);
    return NextResponse.json({
      received: true,
      decision: "ignore",
      reason: decision.reason,
    });
  }

  after(() => processWebhook(webhook));
  return NextResponse.json({ received: true, decision: "queued" });
}

async function processWebhook(webhook: ChatwootWebhook) {
  const startedAt = Date.now();

  let org = await resolveOrganization(webhook);
  if (!org) org = await getFacilitaOrgFallback();
  if (!org) {
    console.warn("[caio:tenant]", "nenhuma org encontrada");
    return;
  }

  const supabase = createAdminClient();

  // Sincroniza estado da IA (caio_ativo) com a etiqueta `agente-off`
  // do Chatwoot — vem nos eventos conversation_*
  await sincronizarCaioAtivo(supabase, org.id, webhook);

  const mensagens = extrairMensagens(webhook);
  if (mensagens.length === 0) {
    console.log("[caio:webhook]", "nenhuma mensagem no payload");
    return;
  }

  let processadas = 0;
  // Coleta leadIds que receberam mensagem incoming nova — depois geramos
  // shadow pra eles (1x por lead, mesmo se receberam várias msgs juntas).
  const leadsComIncomingNova = new Set<string>();

  for (const item of mensagens) {
    const res = await processarMensagem(supabase, org.id, item);
    if (res.ok) {
      processadas++;
      if (res.leadId && item.message_type === "incoming") {
        leadsComIncomingNova.add(res.leadId);
      }
    }
  }

  console.log(
    "[caio:webhook]",
    "processadas",
    processadas,
    "/",
    mensagens.length,
    `(${Date.now() - startedAt}ms)`,
  );

  // Lead respondeu — zera o ciclo de follow-up e atualiza ultima_msg_lead_em.
  // (Roda em paralelo com a geracao da resposta pra nao atrasar.)
  if (leadsComIncomingNova.size > 0) {
    const ids = Array.from(leadsComIncomingNova);
    await supabase
      .from("leads")
      .update({
        numero_followup: 0,
        numero_reativacao: 0,
        numero_prospeccao: 0,
        proximo_followup_em: null,
        ultima_msg_lead_em: new Date().toISOString(),
      })
      .in("id", ids);
    // Lead em status terminal (perdido/fechou) que respondeu: re-engajou
    // espontaneamente — volta pro fluxo inbound em conversa. Origem vira
    // inbound de novo (mesmo se tinha sido marcado prospeccao no passado),
    // ja que agora o cliente esta procurando a gente.
    // Roda ANTES das outras branches pra capturar quem tava em perdido/fechou
    // — depois das outras o status já mudou e essa branch não acharia mais.
    await supabase
      .from("leads")
      .update({
        proximo_contato_em: null,
        status: "em_conversa",
        origem: "inbound",
      })
      .in("id", ids)
      .in("status", ["perdido", "fechou"]);
    // Lead de prospeccao respondeu: para a cadencia de prospeccao e
    // muda status pra "em_conversa" (cai no fluxo inbound normal). A origem
    // continua "prospeccao" pra historico / filtros.
    await supabase
      .from("leads")
      .update({
        proximo_contato_em: null,
        status: "em_conversa",
      })
      .in("id", ids)
      .eq("origem", "prospeccao")
      .in("status", ["aguardando_primeiro_contato", "em_prospeccao"]);
    // Lead em "novo_lead" que respondeu: vira em_conversa (mantém origem).
    await supabase
      .from("leads")
      .update({ status: "em_conversa" })
      .in("id", ids)
      .eq("status", "novo_lead");

    // Lead com IA desligada mandou msg nova: marca pra notificar humano.
    // Esse flag aparece no sino do header como secao "Aguardando sua resposta".
    // Limpa quando humano responde pelo painel ou liga a IA de volta.
    await supabase
      .from("leads")
      .update({
        precisa_resposta_humana: true,
        precisa_resposta_em: new Date().toISOString(),
      })
      .in("id", ids)
      .eq("caio_ativo", false);
  }

  // Pra cada lead com incoming nova: agenda resposta com debounce. Se chegar
  // outra msg desse lead dentro do debounce, o ciclo antigo desiste e o novo
  // assume — a IA so responde quando o lead realmente parou de digitar.
  for (const leadId of leadsComIncomingNova) {
    await agendarRespostaCaioComDebounce(supabase, org.id, leadId);
  }
}

/**
 * Calcula um tempo de "digitacao" realista pra simular humano antes de mandar
 * a resposta. Calibrado com a velocidade real do Lucas digitando (~490-560
 * ms/char medido); usamos 400 ms/char (desconta o "pensar", que ja esta no
 * tempo de geracao da resposta). SEM TETO de proposito: teto faria toda
 * resposta grande sair com ~o mesmo tempo, criando padrao que o WhatsApp
 * detecta. Proporcional puro + jitter +/-35% => cada resposta com tempo unico.
 * Minimo 6s (msg curta tambem nao sai instantanea).
 */
// 150ms/char ≈ digitação rápida de celular (~40 palavras/min). O valor antigo
// (400ms/char SEM teto) fazia uma resposta de 350 chars levar ~2min20 só de
// "digitando" — cliente real desiste. Teto de 22s: mantém proporcionalidade
// e variação (anti-padrão) sem castigar respostas longas.
const MS_POR_CHAR = 150;
const TETO_DIGITACAO_MS = 22000;
function calcularTempoDigitacao(texto: string): number {
  const len = (texto || "").length;
  const base = Math.max(6000, Math.min(len * MS_POR_CHAR, TETO_DIGITACAO_MS));
  const jitter = 1 + (Math.random() - 0.5) * 0.7; // 0.65x a 1.35x
  return Math.floor(base * jitter);
}
// Áudio: o tempo é o de GRAVAR (≈ falar), bem mais rápido que digitar. ~90 ms/char
// dá perto da duração real da fala. Sem teto (mesmo motivo do texto), jitter +/-30%.
const MS_POR_CHAR_AUDIO = 90;
function calcularTempoAudio(texto: string): number {
  const len = (texto || "").length;
  const base = Math.max(5000, len * MS_POR_CHAR_AUDIO);
  const jitter = 1 + (Math.random() - 0.5) * 0.6;
  return Math.floor(base * jitter);
}

/**
 * Wrapper pra enviarMensagem com delay de digitacao. Use em respostas
 * AUTOMATICAS da IA. Nao usa em notificacoes admin / workers.
 */
async function enviarComoCaio(opts: {
  conversationId: number;
  content: string;
  instanceOverride?: string | null;
}): Promise<ReturnType<typeof enviarMensagem>> {
  const ms = calcularTempoDigitacao(opts.content);
  console.log("[caio:typing]", ms, "ms para", opts.content.length, "chars");
  void sinalizarPresenca(opts.conversationId, "composing", ms, opts.instanceOverride); // "digitando..." no WhatsApp
  await new Promise((r) => setTimeout(r, ms));
  return enviarMensagem(opts);
}

/**
 * Agenda resposta da IA com debounce: se chegar outra msg do mesmo lead
 * antes do timer estourar, esse ciclo desiste e o novo assume. A IA so
 * responde quando o lead parou de mandar mensagens por DEBOUNCE segundos.
 */
export async function agendarRespostaCaioComDebounce(
  supabase: ReturnType<typeof createAdminClient>,
  organizationId: string,
  leadId: string,
) {
  // Le tempo BASE de debounce da org (default 10s se nao configurado).
  // Adiciona variacao aleatoria por LEAD pra evitar padrao de bot quando
  // multiplos contatos escrevem ao mesmo tempo — cada lead vira com timing
  // diferente. WhatsApp detecta respostas sincronizadas como automacao.
  const { data: org } = await supabase
    .from("organizations")
    .select("caio_debounce_segundos")
    .eq("id", organizationId)
    .single();
  const baseMs = (org?.caio_debounce_segundos ?? 10) * 1000;
  // Jitter de +0% a +80% do base — ex: base=10s → 10s a 18s aleatorio
  const jitter = Math.floor(Math.random() * baseMs * 0.8);
  const debounceMs = baseMs + jitter;

  // Marca o "previsto para" — esse timestamp e o ID desse ciclo de debounce.
  // Se outra msg chegar e reescrever, esse ciclo perdeu e vai desistir.
  const meuPrevistoMs = Date.now() + debounceMs;
  const meuPrevistoIso = new Date(meuPrevistoMs).toISOString();
  await supabase
    .from("leads")
    .update({ caio_responder_em: meuPrevistoIso })
    .eq("id", leadId);

  // Aguarda o debounce
  await new Promise((r) => setTimeout(r, debounceMs));

  // Re-checa: ainda sou o vencedor? Compara como timestamp em ms (o formato
  // de string que volta do Postgres difere do que mandei — +00:00 vs Z).
  const { data: lead } = await supabase
    .from("leads")
    .select("caio_responder_em")
    .eq("id", leadId)
    .single();

  if (!lead?.caio_responder_em) {
    console.log("[caio:debounce] flag limpo, desistindo", leadId);
    return;
  }
  const atualMs = new Date(lead.caio_responder_em).getTime();
  if (atualMs !== meuPrevistoMs) {
    console.log("[caio:debounce] reagendado, desistindo", leadId);
    return;
  }

  // Sou o vencedor — processa e limpa o flag
  await responderLeadAuto(supabase, organizationId, leadId);
  // SÓ limpa se o flag ainda é meu. Se uma msg seguinte chegou enquanto
  // eu rodava o responderLeadAuto e atualizou caio_responder_em pra outro
  // valor, NÃO posso zerar — senão a próxima rodada vai pensar que perdeu
  // a corrida e desistir (race condition observada quando duas msgs chegam
  // em sequência e a IA leva mais que 6s pra responder a primeira).
  const { data: leadFinal } = await supabase
    .from("leads")
    .select("caio_responder_em")
    .eq("id", leadId)
    .single();
  if (
    leadFinal?.caio_responder_em &&
    new Date(leadFinal.caio_responder_em).getTime() === meuPrevistoMs
  ) {
    await supabase
      .from("leads")
      .update({ caio_responder_em: null })
      .eq("id", leadId);
  }
}

async function sincronizarCaioAtivo(
  supabase: ReturnType<typeof createAdminClient>,
  organizationId: string,
  webhook: ChatwootWebhook,
) {
  if (
    webhook.event !== "conversation_created" &&
    webhook.event !== "conversation_updated"
  ) {
    return;
  }
  const conv = webhook as ChatwootWebhookConversationUpdated;
  if (typeof conv.id !== "number") return;

  const labels = conv.labels ?? [];
  const caioAtivo = !labels.includes("agente-off");

  await supabase
    .from("leads")
    .update({ caio_ativo: caioAtivo })
    .eq("organization_id", organizationId)
    .eq("chatwoot_conversation_id", conv.id);
}

type MensagemNormalizada = {
  chatwoot_message_id: number;
  conversation_id: number | undefined;
  content: string | null;
  message_type: "incoming" | "outgoing";
  sender: ChatwootSender | undefined;
  attachments:
    | NonNullable<ChatwootWebhookMessageCreated["attachments"]>
    | undefined;
  private: boolean;
};

/**
 * Extrai mensagens do payload, normalizando ambos os formatos:
 * - message_created/updated: a mensagem está no body raiz
 * - conversation_*: a mensagem está dentro de `messages[]`
 */
function extrairMensagens(webhook: ChatwootWebhook): MensagemNormalizada[] {
  if (
    webhook.event === "message_created" ||
    webhook.event === "message_updated"
  ) {
    const m = webhook as ChatwootWebhookMessageCreated;
    return [
      {
        chatwoot_message_id: m.id,
        conversation_id: m.conversation?.id,
        content: m.content,
        message_type: normalizeMessageType(m.message_type),
        sender: m.sender,
        attachments: m.attachments,
        private: m.private ?? false,
      },
    ];
  }

  if (
    webhook.event === "conversation_created" ||
    webhook.event === "conversation_updated"
  ) {
    const conv = webhook as ChatwootWebhookConversationUpdated;
    const msgs = conv.messages ?? [];
    return msgs.map((m: ChatwootMessage) => ({
      chatwoot_message_id: m.id,
      conversation_id: m.conversation_id ?? conv.id,
      content: m.content,
      message_type: normalizeMessageType(m.message_type),
      sender: m.sender ?? conv.meta?.sender,
      attachments: m.attachments,
      private: m.private ?? false,
    }));
  }

  return [];
}

/**
 * A IA responde o lead automaticamente.
 *
 * 1. Verifica se a IA tá ativa (se humano assumiu via agente-off, não responde)
 * 2. Gera resposta texto via OpenAI
 * 3. Se a ÚLTIMA mensagem do lead foi áudio, converte resposta em áudio TTS
 *    (ElevenLabs) e envia como attachment de áudio
 * 4. Senão, envia como texto
 * 5. NÃO grava no banco aqui — webhook de conversation_updated vai voltar
 *    com a mensagem outgoing e o handler grava normal (dedup pelo
 *    chatwoot_message_id)
 */
async function responderLeadAuto(
  supabase: ReturnType<typeof createAdminClient>,
  organizationId: string,
  leadId: string,
) {
  const { data: lead } = await supabase
    .from("leads")
    .select(
      "nome, telefone, caio_ativo, chatwoot_conversation_id, aguardando_resposta_adiamento, evolution_instance",
    )
    .eq("id", leadId)
    .single();

  if (!lead || !lead.caio_ativo) return;
  if (!lead.chatwoot_conversation_id) {
    console.warn("[caio:auto]", "lead sem conversation_id:", leadId);
    return;
  }

  // FIXA a instância que vai responder no MOMENTO em que esse ciclo começa.
  // Se o lead mandar msg pra outro número (ex: Juliana) enquanto essa resposta
  // (gerada como Caio) está em voo — transcrição + LLM + TTS + delay de digitação
  // levam dezenas de segundos —, o evolution_instance do lead muda; sem fixar,
  // o áudio do Caio sairia pela Juliana (race do roteamento dinâmico). Pinado,
  // a resposta sai pelo número que a originou; a msg pra Juliana gera o ciclo dela.
  const instancePin =
    (lead as { evolution_instance?: string | null }).evolution_instance ?? null;
  console.log(`[T:resposta] lead=${leadId} instancePin=${instancePin ?? "-"}`);

  // Olha o tipo da última mensagem incoming pra decidir formato da resposta
  const { data: ultimaIncoming } = await supabase
    .from("mensagens")
    .select("tipo, conteudo")
    .eq("lead_id", leadId)
    .eq("direcao", "entrada")
    .order("created_at", { ascending: false })
    .limit(1)
    .single();
  const responderComAudio = ultimaIncoming?.tipo === "audio";

  // Marca que a IA começou a processar — UI mostra "está digitando..."
  await supabase
    .from("leads")
    .update({ caio_processing_since: new Date().toISOString() })
    .eq("id", leadId);

  // Extrator de pedido (Beba Mais): mantém o pedido estruturado do lead em
  // sincronia com a conversa. Fire-and-forget — nunca atrasa nem derruba a
  // resposta. Roda 1x por ciclo (o debounce já serializa por lead) e cobre
  // todos os branches abaixo (handoff/aceite/adiamento/LLM).
  void extrairEAtualizarPedido({ organizationId, leadId }).catch((e) =>
    console.warn(
      "[pedido:extrator]",
      e instanceof Error ? e.message : String(e),
    ),
  );

  try {
    // GUARDRAIL anti-ban — OPT-OUT: lead pediu pra parar ("não quero mais",
    // "para de me mandar"...). Marca opt_out, ZERA toda cadência proativa,
    // agradece UMA vez e sai. Os workers (followup/reativação/prospecção)
    // ignoram leads opt_out na origem.
    if (ehOptOut(ultimaIncoming?.conteudo)) {
      await supabase
        .from("leads")
        .update({
          opt_out: true,
          opt_out_em: new Date().toISOString(),
          followup_ativo: false,
          proximo_followup_em: null,
          proximo_contato_em: null,
        })
        .eq("id", leadId);
      await enviarComoCaio({
        conversationId: lead.chatwoot_conversation_id,
        content:
          "Tranquilo! Não te mando mais nada. Se mudar de ideia ou precisar de algo, é só me chamar por aqui. Abraço!",
        instanceOverride: instancePin,
      });
      console.log("[guardrail] opt-out marcado pra lead", leadId);
      return;
    }

    // ATALHO determinístico: se a pergunta é sobre disponibilidade/dias/
    // horários atendidos, responde direto da config (sem LLM). Evita
    // alucinação do tipo "não atendemos terça" quando a config diz que sim.
    const respDisp = await tentarResponderDisponibilidade({
      organizationId,
      conteudoLead: ultimaIncoming?.conteudo ?? null,
      nomeLead: lead.nome ?? null,
    });
    if (respDisp) {
      console.log("[caio:disp] resposta determinística pra", leadId);
      await enviarComoCaio({
        conversationId: lead.chatwoot_conversation_id,
        content: respDisp,
        instanceOverride: instancePin,
      });
      await agendarPrimeiroFollowup(supabase, organizationId, leadId);
      return;
    }

    // HANDOFF: lead pede reagendar/cancelar retirada, está irritado, ou pede
    // humano → a IA sai, marca lead com flag, notifica admin no WhatsApp,
    // responde com canned text. Roda ANTES de aceite/adiamento porque
    // "reagendar" não é aceite e seria mal-classificado se passasse adiante.
    const handoffResult = await tentarTratarHandoff(
      supabase,
      organizationId,
      leadId,
      lead.nome ?? null,
      (lead as { telefone?: string }).telefone ?? "",
      lead.chatwoot_conversation_id,
      ultimaIncoming?.conteudo ?? null,
      instancePin,
    );
    if (handoffResult) return;

    // ORDEM IMPORTA: aceite ANTES de adiamento. Quando o lead já está no
    // contexto de agendar retirada, "segunda de tarde" é aceite com horário,
    // não pedido pra falar depois. Se rodar adiamento primeiro, ele captura
    // a data e responde "te chamo no dia X" — comportamento errado.
    const aceite = await tentarTratarAceite(
      supabase,
      organizationId,
      leadId,
      ultimaIncoming?.conteudo ?? null,
    );

    if (!aceite) {
      const tratouAdiamento = await tentarTratarAdiamento(
        supabase,
        organizationId,
        leadId,
        lead.nome ?? null,
        lead.chatwoot_conversation_id,
        lead.aguardando_resposta_adiamento ?? false,
        ultimaIncoming?.conteudo ?? null,
        instancePin,
      );
      if (tratouAdiamento) return;
    }

    if (aceite?.tipo === "resposta_direta") {
      // Resposta determinística — envia direto, sem passar pelo LLM
      console.log("[caio:aceite] resposta determinística pra", leadId);
      await enviarComoCaio({
        conversationId: lead.chatwoot_conversation_id,
        content: aceite.texto,
        instanceOverride: instancePin,
      });
      await agendarPrimeiroFollowup(supabase, organizationId, leadId);
      return;
    }
    await gerarERespondeCaio(
      supabase,
      organizationId,
      leadId,
      lead.chatwoot_conversation_id,
      responderComAudio,
      aceite?.tipo === "extras" ? aceite.extrasContexto : undefined,
      instancePin,
    );
    // A IA respondeu — agenda o primeiro follow-up baseado na config da org
    await agendarPrimeiroFollowup(supabase, organizationId, leadId);
  } finally {
    // Sempre limpa o flag, mesmo em erro — UI volta ao normal
    await supabase
      .from("leads")
      .update({ caio_processing_since: null })
      .eq("id", leadId);
  }
}

/**
 * Detecta se a ultima msg do lead pede adiamento ou informa quando contatar.
 * Retorna true se ja respondeu o lead (caso adiamento) — webhook nao precisa
 * fazer mais nada. Retorna false pra fluxo normal de resposta.
 */
async function tentarTratarAdiamento(
  supabase: ReturnType<typeof createAdminClient>,
  organizationId: string,
  leadId: string,
  nome: string | null,
  conversationId: number,
  aguardandoResposta: boolean,
  ultimaMsg: string | null,
  instancePin?: string | null,
): Promise<boolean> {
  if (!ultimaMsg?.trim()) return false;

  // Le contexto das ultimas 6 msgs pro classificador
  const { data: msgs } = await supabase
    .from("mensagens")
    .select("direcao, conteudo")
    .eq("lead_id", leadId)
    .eq("shadow", false)
    .order("created_at", { ascending: false })
    .limit(6);
  const contexto = (msgs ?? [])
    .reverse()
    .map((m) => `${m.direcao === "entrada" ? "Lead" : "Atendente"}: ${m.conteudo}`)
    .join("\n");

  const classif = await classificarAdiamento({
    ultimaMensagem: ultimaMsg,
    contextoAnterior: contexto,
    aguardandoResposta,
  });

  const primeiroNome = nome?.split(" ")[0] || "tudo bem";

  if (classif.intencao === "pede_adiamento_sem_data") {
    // A IA pergunta quando — marca flag pra proxima msg ser interpretada como resposta
    await supabase
      .from("leads")
      .update({ aguardando_resposta_adiamento: true })
      .eq("id", leadId);
    const texto = `Tranquilo, ${primeiroNome}! Quando posso te chamar?`;
    await enviarComoCaio({ conversationId, content: texto, instanceOverride: instancePin });
    console.log("[caio:adiamento]", leadId, "perguntou quando");
    return true;
  }

  if (classif.intencao === "informa_data") {
    const momento = new Date(classif.momento_iso);
    // Status pra contatar_futuramente, desliga followup, agenda retomada
    await supabase
      .from("leads")
      .update({
        status: "contatar_futuramente",
        followup_ativo: false,
        proximo_followup_em: null,
        aguardando_resposta_adiamento: false,
        proximo_contato_em: momento.toISOString(),
        numero_followup: 0,
        numero_reativacao: 0,
      })
      .eq("id", leadId);
    const dataStr = momento.toLocaleString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "America/Sao_Paulo",
    });
    const texto = `Perfeito, ${primeiroNome}! Anotei aqui — te chamo no dia ${dataStr}. Até lá!`;
    await enviarComoCaio({ conversationId, content: texto, instanceOverride: instancePin });
    console.log("[caio:adiamento]", leadId, "agendado pra", momento.toISOString());
    return true;
  }

  // responde_normal — limpa flag de aguardando (caso estivesse setada e o lead
  // ignorou a pergunta) e segue fluxo normal
  if (aguardandoResposta) {
    await supabase
      .from("leads")
      .update({ aguardando_resposta_adiamento: false })
      .eq("id", leadId);
  }
  return false;
}

/**
 * Detecta se a última msg do lead aceita agendar retirada. Retorna extras
 * pro contexto da IA quando classifica como aceite (com ou sem horário) —
 * o caller passa esses extras pra `gerarERespondeCaio` que gera resposta
 * natural com base nas instruções.
 *
 * - aceita_com_horario: tenta criar agendamento. Se conseguir, extras instruem
 *   a IA a confirmar. Se falhar (fora de slot, conflito), extras instruem
 *   a IA a propor alternativas.
 * - aceita_sem_horario: busca slots livres e instrui a IA a propor.
 * - nao_aceita / responde_normal: retorna null (fluxo normal).
 */
/**
 * Detecta se o lead pede reagendar/cancelar retirada, esta irritado ou pede
 * humano. Se sim: dispara handoff (IA off + notifica admin + responde
 * canned text) e retorna true.
 */
async function tentarTratarHandoff(
  supabase: ReturnType<typeof createAdminClient>,
  organizationId: string,
  leadId: string,
  nome: string | null,
  telefone: string,
  conversationId: number,
  ultimaMsg: string | null,
  instancePin?: string | null,
): Promise<boolean> {
  if (!ultimaMsg?.trim()) return false;

  // Contexto: ultimas 6 msgs (Lead/Atendente)
  const { data: msgs } = await supabase
    .from("mensagens")
    .select("direcao, conteudo")
    .eq("lead_id", leadId)
    .eq("shadow", false)
    .order("created_at", { ascending: false })
    .limit(6);
  const contexto = (msgs ?? [])
    .reverse()
    .map((m) => `${m.direcao === "entrada" ? "Lead" : "Atendente"}: ${m.conteudo}`)
    .join("\n");

  // Todas as personas do pool (Caio, Yasmin, ...) são a MESMA IA — o classificador
  // precisa saber disso pra não tratar "tava falando com o Caio" como pedido de humano.
  const { data: personasPool } = await supabase
    .from("org_numeros")
    .select("persona_nome")
    .eq("organization_id", organizationId);
  const nomesPersonas = (personasPool ?? [])
    .map((p) => (p as { persona_nome?: string | null }).persona_nome)
    .filter((n): n is string => !!n);
  const classif = await classificarHandoff({
    ultimaMensagem: ultimaMsg,
    contextoAnterior: contexto,
    personas: nomesPersonas.length ? nomesPersonas : ["Caio"],
  });

  if (classif.intencao === "nenhum") return false;

  // muda_reuniao so faz sentido se o lead JA TEM retirada marcada. Sem isso,
  // "marcar uma retirada" ou "as 10:30" sao falsos positivos comuns.
  if (classif.intencao === "muda_reuniao") {
    const { data: agendamentoExistente } = await supabase
      .from("agendamentos")
      .select("id")
      .eq("lead_id", leadId)
      .in("status", ["sugerido", "agendado"])
      .gte("data_inicio", new Date().toISOString())
      .limit(1)
      .maybeSingle();
    if (!agendamentoExistente) {
      console.log(
        "[caio:handoff]",
        leadId,
        "muda_reuniao ignorado — lead nao tem agendamento futuro",
      );
      return false;
    }
  }

  console.log("[caio:handoff]", leadId, "disparou:", classif.intencao);

  const { texto } = await dispararHandoff({
    organizationId,
    leadId,
    leadNome: nome,
    leadTelefone: telefone,
    motivo: classif.intencao,
    ultimaMsg,
  });

  await enviarComoCaio({
    conversationId,
    content: texto,
    instanceOverride: instancePin,
  });

  return true;
}

async function tentarTratarAceite(
  supabase: ReturnType<typeof createAdminClient>,
  organizationId: string,
  leadId: string,
  ultimaMsg: string | null,
): Promise<
  | { tipo: "extras"; extrasContexto: string[] }
  | { tipo: "resposta_direta"; texto: string }
  | null
> {
  if (!ultimaMsg?.trim()) return null;

  // Se o lead JA tem agendamento futuro (sugerido ou confirmado), nao roda o
  // classificador de aceite. Caso contrario "Pode sim" (confirmando lembrete)
  // vira tentativa de criar novo agendamento. Reagendamento eh capturado pelo
  // classificador de adiamento, nao por aqui.
  const { data: agendamentoExistente } = await supabase
    .from("agendamentos")
    .select("id, data_inicio")
    .eq("lead_id", leadId)
    .in("status", ["sugerido", "agendado"])
    .gte("data_inicio", new Date().toISOString())
    .order("data_inicio", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (agendamentoExistente) {
    console.log(
      "[caio:aceite]",
      leadId,
      "skipping classificador — lead ja tem agendamento futuro",
      agendamentoExistente.id,
    );
    return null;
  }

  // Contexto: últimas 6 msgs em ordem cronológica
  const { data: msgs } = await supabase
    .from("mensagens")
    .select("direcao, conteudo")
    .eq("lead_id", leadId)
    .eq("shadow", false)
    .order("created_at", { ascending: false })
    .limit(6);
  const contexto = (msgs ?? [])
    .reverse()
    .map((m) => `${m.direcao === "entrada" ? "Lead" : "Atendente"}: ${m.conteudo}`)
    .join("\n");

  const classif = await classificarAceite({
    ultimaMensagem: ultimaMsg,
    contextoAnterior: contexto,
  });

  if (classif.intencao === "aceita_com_horario") {
    const momento = new Date(classif.momento_iso);
    const result = await tentarAgendar({
      organizationId,
      leadId,
      momento,
    });
    if ("ok" in result) {
      // Mudar status do lead pra "reuniao_agendada" e desligar followup
      await supabase
        .from("leads")
        .update({
          status: "reuniao_agendada",
          followup_ativo: false,
          proximo_followup_em: null,
          proximo_contato_em: null,
          aguardando_resposta_adiamento: false,
        })
        .eq("id", leadId);
      const dataStr = new Date(result.agendamento.data_inicio).toLocaleString(
        "pt-BR",
        {
          weekday: "long",
          day: "2-digit",
          month: "long",
          hour: "2-digit",
          minute: "2-digit",
          timeZone: "America/Sao_Paulo",
        },
      );
      console.log("[caio:aceite]", leadId, "anotou horário sugerido pra", result.agendamento.data_inicio);
      // Mantém via LLM porque é uma confirmação simples — não tem risco de
      // alucinação inventando horário.
      return {
        tipo: "extras",
        extrasContexto: [
          `[HORÁRIO ANOTADO] O cliente sugeriu um horário pra retirada/entrega e ele JÁ FOI ANOTADO pra equipe: ${dataStr} (fuso de Brasília). Diga de forma natural e curta que você anotou esse horário e que a EQUIPE vai confirmar com ele. Cite data e hora exatas. NÃO diga que está "agendado" ou "confirmado" — é o horário que ele sugeriu e a equipe confirma.`,
        ],
      };
    }
    // Horário não serve (loja fechada, data distante etc.) — resposta
    // determinística explicando o FUNCIONAMENTO da loja, sem LLM.
    console.log("[caio:aceite]", leadId, "horário não serve:", result.motivo);
    const func = result.funcionamento;
    const abreF = func?.abre ?? "08:00";
    const fechaF = func?.fecha ?? "18:00";
    const diasTextoF = descreverDiasNatural(func?.diasSemana ?? [1, 2, 3, 4, 5]);
    const { data: leadInfo } = await supabase
      .from("leads")
      .select("nome")
      .eq("id", leadId)
      .single();
    const primeiroNome = leadInfo?.nome?.split(" ")[0] ?? null;
    const sauda = primeiroNome ? `${primeiroNome}, ` : "";

    // Dia da semana pedido (em SP) pra usar nas respostas
    const wdPedido = new Intl.DateTimeFormat("en-US", {
      weekday: "short",
      timeZone: "America/Sao_Paulo",
    }).format(momento);
    const mapWd: Record<string, number> = {
      Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7,
    };
    const diaPedidoNum = mapWd[wdPedido] ?? 0;
    const nomesDias = ["", "segunda", "terça", "quarta", "quinta", "sexta", "sábado", "domingo"];
    const nomeDiaPedido = nomesDias[diaPedidoNum] ?? "esse dia";

    let texto: string;
    if (result.motivo === "dia_nao_atendido") {
      texto = `${sauda}${nomeDiaPedido} a loja não abre. Funcionamos ${diasTextoF}, das ${abreF} às ${fechaF}. Qual dia fica melhor pra você?`;
    } else if (result.motivo === "fora_horizonte") {
      texto = `${sauda}essa data tá um pouco distante pra eu já deixar anotada. Me diz um dia mais próximo que eu anoto pra equipe — ou me chama de novo mais perto da data, combinado?`;
    } else if (result.motivo === "no_passado") {
      texto = `${sauda}esse horário já passou. Me diz um dia e horário daqui pra frente? A loja abre ${diasTextoF}, das ${abreF} às ${fechaF}.`;
    } else if (result.motivo === "fora_funcionamento") {
      texto = `${sauda}nesse horário a loja tá fechada — funcionamos das ${abreF} às ${fechaF}. Me diz outro horário dentro desse período que eu já deixo anotado pra equipe.`;
    } else {
      texto = `${sauda}tive um probleminha pra anotar aqui. Pode me confirmar de novo o dia e o horário?`;
    }
    return { tipo: "resposta_direta", texto };
  }

  if (classif.intencao === "aceita_sem_horario") {
    // Informa o funcionamento da loja e convida o cliente a dizer dia+horário.
    // O horário dele vira SUGESTÃO anotada — a equipe confirma depois.
    const { data: orgInfo } = await supabase
      .from("organizations")
      .select("agenda_config")
      .eq("id", organizationId)
      .single();
    const cfg = orgInfo?.agenda_config
      ? getAgendaConfig(orgInfo.agenda_config)
      : AGENDA_CONFIG_DEFAULT;
    const { abre, fecha } = janelaFuncionamento(cfg);
    const diasDesc = descreverDiasNatural(cfg.dias_semana);
    console.log("[caio:aceite]", leadId, "aceitou sem horario — informando funcionamento (determinístico)");
    const { data: leadInfo2 } = await supabase
      .from("leads")
      .select("nome")
      .eq("id", leadId)
      .single();
    const primeiroNome2 = leadInfo2?.nome?.split(" ")[0] ?? null;
    const nome2 = primeiroNome2 ? `, ${primeiroNome2}` : "";
    return {
      tipo: "resposta_direta",
      texto: `Perfeito${nome2}! A loja abre ${diasDesc}, das ${abre} às ${fecha}. Me diz o dia e o horário que ficam melhores pra você que eu já deixo anotado pra equipe.`,
    };
  }

  // nao_aceita ou responde_normal → fluxo normal
  return null;
}

/**
 * Depois que a IA responde, agenda o 1º follow-up segundo a config da org.
 * Se a org nao tem followup_config ou nao tem regras ativas, nao agenda nada.
 */
async function agendarPrimeiroFollowup(
  supabase: ReturnType<typeof createAdminClient>,
  organizationId: string,
  leadId: string,
) {
  // Se lead tem retomada agendada, NAO agenda follow-up — o worker de
  // retomadas vai religar follow-up quando disparar a msg combinada.
  // Isso evita follow-up "atropelar" o contato futuro programado.
  const { data: leadCheck } = await supabase
    .from("leads")
    .select("proximo_contato_em, origem")
    .eq("id", leadId)
    .single();
  if (leadCheck?.proximo_contato_em) {
    console.log("[caio:agendar]", leadId, "skipping — tem retomada agendada");
    return;
  }

  // Lead de prospeccao que respondeu: usa cadencia de follow-up de prospeccao
  // (tom diferente do inbound).
  const ehProspeccao = leadCheck?.origem === "prospeccao";
  const { data: org } = await supabase
    .from("organizations")
    .select("followup_config, prospeccao_followup_config")
    .eq("id", organizationId)
    .single();

  type RegraSimples = {
    nivel: number;
    esperar_dias: number;
    esperar_horas: number;
    esperar_minutos: number;
    ativo: boolean;
  };
  const configProsp = org?.prospeccao_followup_config as
    | { regras?: RegraSimples[] }
    | null;
  const configInbound = org?.followup_config as
    | { regras?: RegraSimples[] }
    | null;
  // Prospeccao usa sua cadencia propria; cai pro inbound se ainda nao configurada.
  const usaProsp =
    ehProspeccao && (configProsp?.regras?.length ?? 0) > 0;
  const config = usaProsp ? configProsp : configInbound;
  const primeiraRegra = config?.regras?.find((r) => r.ativo && r.nivel === 1);
  if (!primeiraRegra) return;

  const proximoEm = new Date();
  proximoEm.setDate(proximoEm.getDate() + (primeiraRegra.esperar_dias ?? 0));
  proximoEm.setHours(proximoEm.getHours() + (primeiraRegra.esperar_horas ?? 0));
  proximoEm.setMinutes(
    proximoEm.getMinutes() + (primeiraRegra.esperar_minutos ?? 0),
  );

  await supabase
    .from("leads")
    .update({ proximo_followup_em: proximoEm.toISOString() })
    .eq("id", leadId);
}

async function gerarERespondeCaio(
  supabase: ReturnType<typeof createAdminClient>,
  organizationId: string,
  leadId: string,
  conversationId: number,
  responderComAudio: boolean,
  extrasContexto?: string[],
  instancePin?: string | null,
) {
  // Continuação vinda de OUTRO número: se o lead trocou de atendente (ex: vinha
  // com a Juliana e agora escreveu pro Caio), instrui a persona a RECONHECER a
  // troca e VALIDAR um ponto real da conversa anterior antes de seguir. A flag
  // `instancia_anterior` é setada no webhook quando há troca de número.
  const extrasFinal = extrasContexto ? [...extrasContexto] : [];
  const { data: leadTroca } = await supabase
    .from("leads")
    .select("instancia_anterior")
    .eq("id", leadId)
    .maybeSingle();
  const instAnterior =
    (leadTroca as { instancia_anterior?: string | null } | null)?.instancia_anterior ?? null;
  if (instAnterior && instAnterior !== instancePin) {
    const [personaAnt, personaAtual] = await Promise.all([
      personaDoLead(instAnterior),
      personaDoLead(instancePin ?? null),
    ]);
    const nomeAnt = personaAnt?.persona_nome || "outro atendente do nosso time";
    const nomeAtual = personaAtual?.persona_nome || "o atendente";
    extrasFinal.push(
      `CONTINUACAO DE OUTRO NUMERO: este lead vinha conversando com ${nomeAnt} em outro numero nosso e agora escreveu aqui (voce e ${nomeAtual} — mesmo time, mesma empresa). Na SUA PROXIMA resposta: (1) reconheca a troca de forma natural e acolhedora (ex: "vamos continuar por aqui"); (2) SE — e somente se — o historico acima tiver um ponto CONCRETO que ELE falou (item de pedido, retirada ou entrega, bairro/endereco), retome esse ponto; se o historico NAO tiver nada concreto, NAO afirme nada sobre ele — so pergunte no que pode ajudar hoje. NUNCA invente dados e NUNCA repita exemplos desta instrucao como se fossem fatos. Tudo em 1-2 frases curtas, no maximo UMA pergunta.`,
    );
    // Consome a flag — a validacao acontece UMA vez por troca.
    await supabase.from("leads").update({ instancia_anterior: null }).eq("id", leadId);
    console.log("[caio:troca]", leadId, "continuacao de", nomeAnt, "->", nomeAtual);
  }

  // Gera resposta (já tem retry interno no chatCompletion)
  const result = await gerarRespostaCaio({ leadId, extrasContexto: extrasFinal });
  if ("error" in result) {
    console.error("[caio:auto]", "erro ao gerar:", result.error);
    // Notifica admin via WhatsApp — a IA realmente desistiu deste lead.
    // Busca dados do lead pra mensagem do alerta.
    const { data: leadFalha } = await supabase
      .from("leads")
      .select("nome, telefone")
      .eq("id", leadId)
      .single();
    const { data: msgLead } = await supabase
      .from("mensagens")
      .select("conteudo")
      .eq("lead_id", leadId)
      .eq("direcao", "entrada")
      .order("created_at", { ascending: false })
      .limit(1)
      .single();
    await notificarAdminFalha({
      organizationId,
      leadNome: leadFalha?.nome ?? null,
      leadTelefone: leadFalha?.telefone ?? "(desconhecido)",
      conteudoLead: msgLead?.conteudo ?? null,
      erro: result.error,
    });
    return;
  }
  const texto = result.resposta;

  // Detecta se a resposta eh uma desqualificacao BANT. Se sim, marca o lead
  // (pra metricas) e desliga a IA. nao_encaixa = lead nao serve; trazer_decisor
  // eh hint do prompt mas nao desqualifica definitivo (so vira "perdido" se
  // lead recusar trazer o decisor depois).
  const desq = detectarDesqualificacao(texto);
  if (desq?.motivo === "nao_encaixa") {
    await supabase
      .from("leads")
      .update({
        desqualificado: true,
        desqualificacao_motivo: desq.motivo,
        desqualificado_em: new Date().toISOString(),
        status: "perdido",
        caio_ativo: false,
        followup_ativo: false,
        proximo_followup_em: null,
        proximo_contato_em: null,
      })
      .eq("id", leadId);
    console.log("[caio:desq]", leadId, "desqualificado BANT");
  }

  if (responderComAudio) {
    // Voz: prefere a do NÚMERO que serve o lead (persona_voice_id — ex: Juliana
    // com voz própria); fallback pra voz global da org. Usa a instância
    // PINADA (a que originou a resposta) — não o evolution_instance atual do lead,
    // que pode ter trocado de número no meio (senão sairia a voz errada).
    let instVoz = instancePin ?? null;
    if (!instVoz) {
      const { data: leadVoz } = await supabase
        .from("leads")
        .select("evolution_instance")
        .eq("id", leadId)
        .maybeSingle();
      instVoz = (leadVoz as { evolution_instance?: string | null } | null)?.evolution_instance ?? null;
    }
    const personaV = await personaDoLead(instVoz);
    const { data: org } = await supabase
      .from("organizations")
      .select("voice_id, voice_settings")
      .eq("id", organizationId)
      .single();

    // TTS via ElevenLabs + envia áudio
    const tts = await gerarAudio({
      texto,
      voiceId: personaV?.persona_voice_id || org?.voice_id || undefined,
      voiceSettings: org?.voice_settings ?? null,
    });
    if ("error" in tts) {
      console.warn(
        "[caio:auto]",
        "TTS falhou, caindo pra texto:",
        tts.error,
      );
      // Fallback: envia texto se TTS falhou
      const sent = await enviarComoCaio({
        conversationId,
        content: texto,
        instanceOverride: instancePin,
      });
      if ("error" in sent) {
        console.error("[caio:auto]", "envio fallback falhou:", sent.error);
      }
      return;
    }

    // Áudio também leva tempo "humano" (gravar) — antes saía quase instantâneo,
    // o que o Lucas notou. Mesma fórmula de digitação sobre o texto falado.
    const msAudio = calcularTempoAudio(texto);
    console.log("[caio:typing] audio", msAudio, "ms para", texto.length, "chars");
    void sinalizarPresenca(conversationId, "recording", msAudio, instancePin); // "gravando áudio..." no WhatsApp
    await new Promise((r) => setTimeout(r, msAudio));
    const sent = await enviarMensagemComAudio({
      conversationId,
      audio: tts.audio,
      filename: "caio.mp3",
      mimeType: tts.mimeType,
      content: texto, // texto falado vira a "transcrição" exibida no painel
      instanceOverride: instancePin,
    });
    if ("error" in sent) {
      console.error(
        "[caio:auto]",
        "envio áudio falhou, fallback texto:",
        sent.error,
      );
      // Fallback: se Chatwoot recusou áudio (timeout, formato, etc),
      // envia texto pra pelo menos o lead receber alguma resposta.
      const fallback = await enviarComoCaio({
        conversationId,
        content: texto,
        instanceOverride: instancePin,
      });
      if ("error" in fallback) {
        console.error("[caio:auto]", "fallback texto falhou:", fallback.error);
      } else {
        console.log("[caio:auto]", "respondeu texto (fallback) pra lead", leadId);
      }
      return;
    }
    console.log("[caio:auto]", "respondeu áudio pra lead", leadId);
  } else {
    const sent = await enviarComoCaio({
      conversationId,
      content: texto,
      instanceOverride: instancePin,
    });
    if ("error" in sent) {
      console.error("[caio:auto]", "envio texto falhou:", sent.error);
      return;
    }
    console.log("[caio:auto]", "respondeu texto pra lead", leadId);
  }
}

async function processarMensagem(
  supabase: ReturnType<typeof createAdminClient>,
  organizationId: string,
  msg: MensagemNormalizada,
): Promise<{ ok: boolean; leadId?: string }> {
  if (msg.private) return { ok: false };
  if (!msg.conversation_id) {
    console.log("[caio:msg]", "sem conversation_id, ignorando");
    return { ok: false };
  }

  let leadId: string | null = null;

  if (msg.message_type === "incoming") {
    const phone = msg.sender?.phone_number;
    if (!phone) {
      console.warn("[caio:msg]", "incoming sem phone_number do sender");
      return { ok: false };
    }
    if (!phoneValido(phone)) {
      console.warn(
        "[caio:msg]",
        "phone invalido (provavelmente teste do Evolution):",
        phone,
      );
      return { ok: false };
    }

    const { data: existing } = await supabase
      .from("leads")
      .select("id, status")
      .eq("organization_id", organizationId)
      .eq("telefone", phone)
      .maybeSingle();

    if (existing) {
      // NÃO mexer em status aqui — as branches mais abaixo (no caller)
      // decidem o status final baseado no status anterior + origem.
      // Mudar status aqui zerava a info que as branches usam (ex: lead em
      // "perdido" virava "em_conversa" antes da branch que seta origem=inbound
      // rodar, então a origem nunca virava inbound).
      await supabase
        .from("leads")
        .update({
          nome: msg.sender?.name,
          chatwoot_conversation_id: msg.conversation_id,
        })
        .eq("id", existing.id);
      leadId = existing.id;
    } else {
      const { data: novo, error } = await supabase
        .from("leads")
        .insert({
          organization_id: organizationId,
          telefone: phone,
          nome: msg.sender?.name,
          status: "em_conversa",
          source: "whatsapp",
          chatwoot_conversation_id: msg.conversation_id,
        })
        .select("id")
        .single();

      if (error || !novo) {
        console.error("[caio:lead]", "erro ao inserir:", error);
        return { ok: false };
      }
      leadId = novo.id;
    }
  } else {
    // outgoing: busca lead pela conversation_id
    const { data: lead } = await supabase
      .from("leads")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("chatwoot_conversation_id", msg.conversation_id)
      .maybeSingle();

    if (!lead) {
      console.log(
        "[caio:msg]",
        "outgoing sem lead correspondente (conv_id=",
        msg.conversation_id,
        ")",
      );
      return { ok: false };
    }
    leadId = lead.id;
  }

  if (!leadId) return { ok: false };

  const gravou = await gravarMensagem(supabase, organizationId, leadId, msg);
  return { ok: gravou, leadId: gravou ? leadId : undefined };
}

async function gravarMensagem(
  supabase: ReturnType<typeof createAdminClient>,
  organizationId: string,
  leadId: string,
  msg: MensagemNormalizada,
): Promise<boolean> {
  const direcao = msg.message_type === "incoming" ? "entrada" : "saida";
  const tipo = inferirTipo(msg.attachments);
  const attachmentUrl = msg.attachments?.[0]?.data_url ?? null;

  const { data, error } = await supabase
    .from("mensagens")
    .insert({
      organization_id: organizationId,
      lead_id: leadId,
      chatwoot_message_id: msg.chatwoot_message_id,
      chatwoot_conversation_id: msg.conversation_id,
      conteudo: msg.content,
      tipo,
      attachment_url: attachmentUrl,
      direcao,
      remetente_nome: msg.sender?.name,
      privada: msg.private,
    })
    .select("id")
    .single();

  if (error) {
    // unique violation no chatwoot_message_id — webhook entregue 2x ou
    // mensagem já gravada (acontece com conversation_updated repetido)
    if (error.code === "23505") return false;
    console.error("[caio:msg]", "erro ao gravar:", error);
    return false;
  }

  // Áudio sem texto transcrito? Aguarda Whisper antes de retornar —
  // tudo isso roda em after() (background) então não atrasa o response
  // pro Chatwoot, mas shadow/sugestão IA precisam do texto pra funcionar.
  if (tipo === "audio" && attachmentUrl && !msg.content && data?.id) {
    await transcreverEAtualizar(supabase, data.id, attachmentUrl);
  }

  return true;
}

async function transcreverEAtualizar(
  supabase: ReturnType<typeof createAdminClient>,
  mensagemId: string,
  audioUrl: string,
) {
  const result = await transcreverAudio({ audioUrl });
  if ("error" in result) {
    console.warn("[caio:whisper]", "erro:", result.error);
    return;
  }
  await supabase
    .from("mensagens")
    .update({ conteudo: result.texto })
    .eq("id", mensagemId);
  console.log(
    "[caio:whisper]",
    "transcrita:",
    result.texto.slice(0, 60),
    mensagemId,
  );
}

/**
 * Aceita phones no formato E.164 com pelo menos 10 dígitos depois do +
 * (ex: +5511999998888). Bloqueia placeholders tipo "+123456" do Evolution.
 */
function phoneValido(phone: string): boolean {
  return /^\+\d{10,15}$/.test(phone);
}

function inferirTipo(
  attachments: MensagemNormalizada["attachments"],
): "texto" | "audio" | "imagem" | "video" | "arquivo" {
  const att = attachments?.[0];
  if (!att) return "texto";
  switch (att.file_type) {
    case "audio":
      return "audio";
    case "image":
      return "imagem";
    case "video":
      return "video";
    default:
      return "arquivo";
  }
}

export async function GET() {
  return NextResponse.json({
    name: "Webhook handler do atendente IA",
    mode: "shadow",
    description:
      "Recebe eventos do Chatwoot (message_* e conversation_*), grava lead e mensagens no Supabase.",
    accepts: "POST application/json",
  });
}
