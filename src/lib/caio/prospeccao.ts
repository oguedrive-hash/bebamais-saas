/**
 * Worker de prospeccao ativa — processa leads outbound que estao com
 * proximo_contato_em vencido.
 *
 * Diferente do worker de follow-up (inbound):
 *  - leads tem origem='prospeccao' e numero_prospeccao indicando a regra
 *  - mensagens sao SEMPRE template fixo (sem IA na primeira fase)
 *  - quando lead responde, webhook ja desliga prospeccao automaticamente
 *
 * O intervalo entre disparos da 1a msg em lote e gerenciado pelo action
 * `dispararPrimeirasMensagensEmLote` (que espacja os agendamentos). O
 * worker em si so processa o `proximo_contato_em` vencido — sem janela
 * horaria ou rate limit.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { logarEvento } from "@/lib/caio/eventos";
import { enviarComMidia } from "@/lib/caio/enviar-com-midia";

type RegraProspeccao = {
  nivel: number;
  esperar_dias: number;
  esperar_horas: number;
  esperar_minutos: number;
  mensagem: string;
  ativo: boolean;
  tipo_midia?: "texto" | "audio" | "imagem" | "video";
  attachment_url?: string | null;
  attachment_mime?: string | null;
};

type LeadProspeccao = {
  id: string;
  nome: string | null;
  telefone: string;
  status: string;
  organization_id: string;
  numero_prospeccao: number | null;
  dados_extras: Record<string, string> | null;
  chatwoot_conversation_id: number | null;
  caio_ativo: boolean | null;
};

function aplicarTemplate(
  msg: string,
  lead: LeadProspeccao,
): string {
  let texto = msg;
  const nome = lead.nome?.split(" ")[0] || "tudo bem";
  texto = texto.replace(/\{nome\}/g, nome);
  // Placeholders dinamicos do dados_extras
  for (const [chave, valor] of Object.entries(lead.dados_extras ?? {})) {
    const re = new RegExp(`\\{${chave}\\}`, "g");
    texto = texto.replace(re, valor);
  }
  // Rede de seguranca: placeholder sem valor (ex: {empresa} quando o lead nao
  // tem o dado) NUNCA pode vazar cru pro lead. Remove o token junto com uma
  // preposicao/artigo imediatamente antes ("dono da {empresa}?" -> "dono?") e
  // depois limpa qualquer placeholder remanescente + espacos/pontuacao orfa.
  texto = texto
    .replace(/\s+(?:d[aeo]s?|n[aeo]s?|[ao]s?|em|pra|para|com)\s+\{[^}]+\}/gi, "")
    .replace(/\s*\{[^}]+\}/g, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([?!.,;:])/g, "$1")
    .trim();
  return texto;
}

function calcularProximoEm(
  dias: number,
  horas: number,
  minutos: number,
): Date {
  const d = new Date();
  d.setDate(d.getDate() + dias);
  d.setHours(d.getHours() + horas);
  d.setMinutes(d.getMinutes() + minutos);
  return d;
}

/**
 * Garante que o lead tem conversa no Chatwoot. Se nao tem, cria.
 * (Leads inbound ja vem com conversa; leads de prospeccao precisam criar
 * porque nunca interagiram antes.)
 */
async function garantirConversaChatwoot(
  lead: LeadProspeccao,
): Promise<{ ok: number } | { error: string }> {
  if (lead.chatwoot_conversation_id) {
    return { ok: lead.chatwoot_conversation_id };
  }
  const { criarConversaProspeccao } = await import(
    "@/lib/caio/chatwoot-api"
  );
  const result = await criarConversaProspeccao({
    organizationId: lead.organization_id,
    telefone: lead.telefone,
    nome: lead.nome ?? "",
  });
  if ("error" in result) return { error: result.error };
  // Persiste no lead pra reusar
  const admin = createAdminClient();
  await admin
    .from("leads")
    .update({ chatwoot_conversation_id: result.conversationId })
    .eq("id", lead.id);
  return { ok: result.conversationId };
}

export async function processarProspeccaoLead(
  lead: LeadProspeccao,
): Promise<{ ok: true; acao: "enviou" | "reagendou" | "esgotou" } | { error: string }> {
  const supabase = createAdminClient();

  if (!lead.caio_ativo) {
    await supabase
      .from("leads")
      .update({ proximo_contato_em: null })
      .eq("id", lead.id);
    return { ok: true, acao: "esgotou" };
  }

  // Le config da org
  const { data: org } = await supabase
    .from("organizations")
    .select("prospeccao_config")
    .eq("id", lead.organization_id)
    .single();

  const config = (org?.prospeccao_config as { regras?: RegraProspeccao[] } | null);

  const regrasAtivas = (config?.regras ?? []).filter((r) => r.ativo);
  // Regra defensive: lead em "aguardando_primeiro_contato" SEMPRE dispara
  // regra 1 — ignora numero_prospeccao (que pode estar travado por execucoes
  // anteriores). Status define a fase, contador apenas o progresso dentro
  // dela.
  const proximoNivel =
    lead.status === "aguardando_primeiro_contato"
      ? 1
      : (lead.numero_prospeccao ?? 0) + 1;
  const regra = regrasAtivas.find((r) => r.nivel === proximoNivel);

  if (!regra) {
    // Esgotou cadencia — marca como perdido
    await supabase
      .from("leads")
      .update({ status: "perdido", proximo_contato_em: null })
      .eq("id", lead.id);
    return { ok: true, acao: "esgotou" };
  }

  // Garante que tem conversa no Chatwoot
  const conv = await garantirConversaChatwoot(lead);
  if ("error" in conv) {
    return { error: `chatwoot: ${conv.error}` };
  }
  const conversationId = conv.ok;

  // Monta texto aplicando placeholders
  const texto = aplicarTemplate(regra.mensagem, lead);

  // Envia
  const sent = await enviarComMidia({
    conversationId,
    organizationId: lead.organization_id,
    texto,
    tipoMidia: regra.tipo_midia ?? "texto",
    attachmentUrl: regra.attachment_url ?? null,
    attachmentMime: regra.attachment_mime ?? null,
  });

  if ("error" in sent) {
    // Número inexistente no WhatsApp é erro PERMANENTE — não adianta retentar
    // a cada 15s (vira retry-storm + sinal de spam/risco de ban). Encerra o lead.
    if (/"exists"\s*:\s*false/i.test(sent.error)) {
      await supabase
        .from("leads")
        .update({
          status: "perdido",
          proximo_contato_em: null,
          dados_extras: { ...(lead.dados_extras ?? {}), erro_envio: "numero_invalido" },
        })
        .eq("id", lead.id);
      await logarEvento({
        leadId: lead.id,
        organizationId: lead.organization_id,
        tipo: "prospeccao_numero_invalido",
        descricao: `Número ${lead.telefone} não existe no WhatsApp — prospecção encerrada.`,
        autorNome: "Caio (automático)",
      }).catch(() => {});
      return { ok: true, acao: "esgotou" };
    }
    return { error: `envio falhou: ${sent.error}` };
  }

  // Atualiza lead — proximo agendamento ou esgotamento
  const proximaRegra = regrasAtivas.find((r) => r.nivel === proximoNivel + 1);
  const update: Record<string, unknown> = {
    numero_prospeccao: proximoNivel,
    status: "em_prospeccao",
  };
  if (proximaRegra) {
    // Cadencia em andamento — usa o delay configurado direto, sem ajustar
    // pra janela. Janela so vale na 1a msg (abordagem fria).
    const desejado = calcularProximoEm(
      proximaRegra.esperar_dias,
      proximaRegra.esperar_horas,
      proximaRegra.esperar_minutos,
    );
    update.proximo_contato_em = desejado.toISOString();
  } else {
    // Foi a ULTIMA regra da cadencia de prospeccao e o cliente nao respondeu.
    // Se a org tem follow-up de prospeccao configurado, transiciona pra
    // status=followup + agenda 1a regra do follow-up. Senao, vai direto pra
    // perdido.
    const { data: orgFup } = await supabase
      .from("organizations")
      .select("prospeccao_followup_config")
      .eq("id", lead.organization_id)
      .single();
    const fupConfig = orgFup?.prospeccao_followup_config as
      | { regras?: RegraProspeccao[] }
      | null;
    const fupAtivas = (fupConfig?.regras ?? []).filter((r) => r.ativo);
    const r1Fup = fupAtivas.find((r) => r.nivel === 1);
    if (r1Fup) {
      // Transiciona pra followup — zera numero_followup pra comecar da regra 1
      // do follow-up de prospeccao.
      const desejado = calcularProximoEm(
        r1Fup.esperar_dias,
        r1Fup.esperar_horas,
        r1Fup.esperar_minutos,
      );
      update.status = "followup";
      update.numero_followup = 0;
      update.proximo_contato_em = null;
      update.proximo_followup_em = desejado.toISOString();
    } else {
      // Sem follow-up configurado — encerra como perdido.
      update.status = "perdido";
      update.proximo_contato_em = null;
    }
  }

  await supabase.from("leads").update(update).eq("id", lead.id);

  await logarEvento({
    leadId: lead.id,
    organizationId: lead.organization_id,
    tipo: "prospeccao_enviada",
    descricao: `Mensagem de prospecção nº${proximoNivel} enviada`,
    autorNome: "Caio (automático)",
    meta: { nivel: proximoNivel },
  });

  return { ok: true, acao: "enviou" };
}

export async function processarProspeccoesPendentes(): Promise<{
  total: number;
  ok: number;
  erros: number;
}> {
  const supabase = createAdminClient();

  const { data: leads, error } = await supabase
    .from("leads")
    .select(
      "id, nome, telefone, status, organization_id, numero_prospeccao, dados_extras, chatwoot_conversation_id, caio_ativo",
    )
    .eq("origem", "prospeccao")
    .eq("caio_ativo", true)
    .not("proximo_contato_em", "is", null)
    .lte("proximo_contato_em", new Date().toISOString())
    .limit(50);

  console.log(
    `[prospec:worker] processarProspeccoesPendentes found=${leads?.length ?? 0} at ${new Date().toISOString()}`,
  );

  if (error || !leads) {
    console.error("[prospeccao:cron]", "erro buscando leads:", error?.message);
    return { total: 0, ok: 0, erros: 0 };
  }

  let okCount = 0;
  let erroCount = 0;
  for (const lead of leads) {
    console.log(
      `[prospec:worker] picked lead=${lead.id} status=${lead.status} numero=${lead.numero_prospeccao}`,
    );
    try {
      const result = await processarProspeccaoLead(lead as LeadProspeccao);
      if ("error" in result) {
        console.error("[prospeccao:cron]", lead.id, result.error);
        erroCount++;
      } else {
        console.log("[prospeccao:cron]", lead.id, result.acao);
        okCount++;
      }
    } catch (err) {
      console.error("[prospeccao:cron]", lead.id, err);
      erroCount++;
    }
  }

  return { total: leads.length, ok: okCount, erros: erroCount };
}

