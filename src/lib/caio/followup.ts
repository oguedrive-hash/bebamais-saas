/**
 * Worker de follow-up — processa leads que estao com proximo_followup_em vencido.
 *
 * Fluxo por lead:
 * 1. Le followup_config da org
 * 2. Olha numero_followup atual e pega a regra do nivel seguinte
 * 3. Se regra.usa_ia, gera resposta via Caio com prompt especial de follow-up
 *    Senao, usa o template substituindo {nome}
 * 4. Envia via Chatwoot
 * 5. Atualiza numero_followup + ultimo_followup_em + proximo_followup_em
 * 6. Se nao houver proxima regra:
 *    - Marca status = "perdido"
 *    - Se reativacao.ativa, agenda proximo_followup_em pra esperar_dias depois
 *    - Senao, zera proximo_followup_em
 */

import { createAdminClient } from "@/lib/supabase/admin";
import {
  enviarMensagem,
  enviarMensagemComAnexoUrl,
  enviarMensagemComAudio,
} from "@/lib/caio/chatwoot-api";
import { gerarRespostaCaio } from "@/lib/caio/gerar-resposta";
import { gerarAudio } from "@/lib/caio/elevenlabs";
import { logarEvento } from "@/lib/caio/eventos";

type Regra = {
  nivel: number;
  esperar_dias: number;
  esperar_horas: number;
  esperar_minutos: number;
  mensagem: string;
  usa_ia: boolean;
  ativo: boolean;
  tipo_midia?: "texto" | "audio" | "imagem" | "video";
  attachment_url?: string | null;
  attachment_mime?: string | null;
};

type ReativacaoRegra = {
  nivel: number;
  esperar_dias: number;
  esperar_horas: number;
  esperar_minutos: number;
  mensagem: string;
  usa_ia: boolean;
  ativo: boolean;
  tipo_midia?: "texto" | "audio" | "imagem" | "video";
  attachment_url?: string | null;
  attachment_mime?: string | null;
};

type Reativacao = {
  ativa: boolean;
  regras: ReativacaoRegra[];
};

type FollowupConfig = {
  regras: Regra[];
  reativacao: Reativacao;
};

/**
 * Aceita shape antigo (campos planos) ou novo (regras[]) e devolve o novo.
 */
function normalizarReativacaoRaw(raw: unknown): Reativacao {
  if (!raw || typeof raw !== "object") return { ativa: false, regras: [] };
  const obj = raw as Record<string, unknown>;
  if (Array.isArray(obj.regras)) {
    return { ativa: !!obj.ativa, regras: obj.regras as ReativacaoRegra[] };
  }
  if (typeof obj.mensagem === "string" || typeof obj.esperar_dias === "number") {
    return {
      ativa: !!obj.ativa,
      regras: [
        {
          nivel: 1,
          esperar_dias: Number(obj.esperar_dias ?? 30),
          esperar_horas: 0,
          esperar_minutos: 0,
          mensagem: String(obj.mensagem ?? ""),
          usa_ia: !!obj.usa_ia,
          ativo: true,
          tipo_midia: (obj.tipo_midia as ReativacaoRegra["tipo_midia"]) ?? "texto",
          attachment_url: (obj.attachment_url as string | null) ?? null,
          attachment_mime: (obj.attachment_mime as string | null) ?? null,
        },
      ],
    };
  }
  return { ativa: !!obj.ativa, regras: [] };
}

type LeadProcess = {
  id: string;
  nome: string | null;
  telefone: string;
  status: string;
  organization_id: string;
  numero_followup: number | null;
  numero_reativacao: number | null;
  chatwoot_conversation_id: number | null;
  caio_ativo: boolean | null;
  followup_ativo: boolean | null;
  ultimo_followup_em: string | null;
  origem: string | null;
};

/**
 * Substitui placeholders em uma mensagem template.
 * Hoje so suporta {nome}; futuramente pode crescer (telefone, empresa, etc).
 */
function aplicarTemplate(msg: string, lead: LeadProcess): string {
  const nome = lead.nome?.split(" ")[0] || "tudo bem";
  return msg.replace(/\{nome\}/g, nome);
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

export async function processarFollowupLead(
  lead: LeadProcess,
): Promise<
  | { ok: true; acao: "followup" | "reativacao" | "desistencia" }
  | { error: string }
> {
  const supabase = createAdminClient();

  if (!lead.chatwoot_conversation_id) {
    return { error: "lead sem chatwoot_conversation_id" };
  }
  if (!lead.caio_ativo || lead.followup_ativo === false) {
    // Caio desligado ou follow-up pausado pelo user — zera o agendamento
    await supabase
      .from("leads")
      .update({ proximo_followup_em: null })
      .eq("id", lead.id);
    return { ok: true, acao: "desistencia" };
  }

  // Le config da org. Lead de prospeccao que ja respondeu (e agora sumiu)
  // usa prospeccao_followup_config — tom diferente do followup inbound.
  const { data: org } = await supabase
    .from("organizations")
    .select(
      "followup_config, followup_mudar_status_a_partir, prospeccao_followup_config",
    )
    .eq("id", lead.organization_id)
    .single();

  const ehProspeccao = lead.origem === "prospeccao";
  const prospFollowup = org?.prospeccao_followup_config as
    | { regras?: Regra[] }
    | null;
  // Lead de prospeccao SEMPRE usa prospeccao_followup_config (sem fallback
  // pro inbound, pra evitar misturar tons). Se nao houver regras de prospeccao,
  // marca perdido e sai — nao tem mais cadencia pra rodar.
  if (ehProspeccao) {
    if ((prospFollowup?.regras?.length ?? 0) === 0) {
      await supabase
        .from("leads")
        .update({
          status: "perdido",
          proximo_followup_em: null,
          proximo_contato_em: null,
        })
        .eq("id", lead.id);
      return { ok: true, acao: "desistencia" };
    }
  }
  const configRaw = ehProspeccao
    ? ({
        regras: prospFollowup?.regras ?? [],
        reativacao: null,
      } as { regras?: Regra[]; reativacao?: unknown })
    : ((org?.followup_config ?? null) as
        | { regras?: Regra[]; reativacao?: unknown }
        | null);
  const mudarStatusAPartir =
    (org?.followup_mudar_status_a_partir as number | null) ?? 1;
  if (!configRaw?.regras) {
    return { error: "org sem followup_config" };
  }
  const config: FollowupConfig = {
    regras: configRaw.regras,
    reativacao: normalizarReativacaoRaw(configRaw.reativacao),
  };

  // Lead ja iniciou reativacao? Vai direto pro fluxo de reativacao
  if ((lead.numero_reativacao ?? 0) > 0) {
    return await processarFimRegras(lead, config);
  }

  const regrasAtivas = config.regras.filter((r) => r.ativo);
  const proximoNivel = (lead.numero_followup ?? 0) + 1;
  const regra = regrasAtivas.find((r) => r.nivel === proximoNivel);

  // Sem regra pra esse nivel → desistir ou tentar reativacao
  if (!regra) {
    return await processarFimRegras(lead, config);
  }

  // Recalcula dinamicamente o instante de disparo baseado na config atual.
  // Se config mudou depois que proximo_followup_em foi setado, esse recalculo
  // garante que o tempo correto seja respeitado.
  // (so se aplica quando ja teve followup anterior, i.e. numero_followup >= 1)
  //
  // Tolerância: ultimo_followup_em e proximo_followup_em são setados por
  // chamadas `new Date()` separadas (uns ms entre elas), então instanteCorreto
  // sempre vai estar uns ms acima de proximo_followup_em. Sem tolerância, o
  // cron pega o lead quando proximo_followup_em vence, mas instanteCorreto
  // ainda está alguns ms no futuro, então reagenda e perde 1 ciclo do cron.
  // 5s de margem cobre essa drift sem afrouxar o respeito à config.
  const TOLERANCIA_MS = 5000;
  if ((lead.numero_followup ?? 0) >= 1 && lead.ultimo_followup_em) {
    const instanteCorreto = new Date(lead.ultimo_followup_em);
    instanteCorreto.setDate(instanteCorreto.getDate() + (regra.esperar_dias ?? 0));
    instanteCorreto.setHours(
      instanteCorreto.getHours() + (regra.esperar_horas ?? 0),
    );
    instanteCorreto.setMinutes(
      instanteCorreto.getMinutes() + (regra.esperar_minutos ?? 0),
    );
    if (instanteCorreto.getTime() > Date.now() + TOLERANCIA_MS) {
      // Ainda nao chegou a hora segundo a config atual — reagenda e nao dispara
      await supabase
        .from("leads")
        .update({ proximo_followup_em: instanteCorreto.toISOString() })
        .eq("id", lead.id);
      return { ok: true, acao: "desistencia" };
    }
  }

  // Gera mensagem (IA ou template)
  let texto: string;
  if (regra.usa_ia) {
    const result = await gerarRespostaCaio({ leadId: lead.id });
    if ("error" in result) {
      console.error("[followup:ia]", lead.id, result.error);
      // Fallback pro template do user
      texto = aplicarTemplate(regra.mensagem, lead);
    } else {
      texto = result.resposta;
    }
  } else {
    texto = aplicarTemplate(regra.mensagem, lead);
  }

  // Envia pelo Chatwoot — formato varia por tipo_midia
  const tipoMidia = regra.tipo_midia ?? "texto";
  let sent: { id?: number } | { error: string };

  if (tipoMidia === "audio") {
    // TTS via ElevenLabs + envio como audio
    const { data: orgVoz } = await supabase
      .from("organizations")
      .select("voice_id, voice_settings")
      .eq("id", lead.organization_id)
      .single();
    const tts = await gerarAudio({
      texto,
      voiceId: orgVoz?.voice_id ?? undefined,
      voiceSettings: orgVoz?.voice_settings ?? null,
    });
    if ("error" in tts) {
      console.warn(
        "[followup:audio]",
        lead.id,
        "TTS falhou, caindo pra texto:",
        tts.error,
      );
      sent = await enviarMensagem({
        conversationId: lead.chatwoot_conversation_id,
        content: texto,
      });
    } else {
      sent = await enviarMensagemComAudio({
        conversationId: lead.chatwoot_conversation_id,
        audio: tts.audio,
        filename: "followup.mp3",
        mimeType: tts.mimeType,
      });
      if ("error" in sent) {
        // Fallback texto se audio falhou
        sent = await enviarMensagem({
          conversationId: lead.chatwoot_conversation_id,
          content: texto,
        });
      }
    }
  } else if (
    (tipoMidia === "imagem" || tipoMidia === "video") &&
    regra.attachment_url &&
    regra.attachment_mime
  ) {
    sent = await enviarMensagemComAnexoUrl({
      conversationId: lead.chatwoot_conversation_id,
      url: regra.attachment_url,
      mimeType: regra.attachment_mime,
      caption: texto,
    });
    if ("error" in sent) {
      // Fallback texto se anexo falhou
      sent = await enviarMensagem({
        conversationId: lead.chatwoot_conversation_id,
        content: texto,
      });
    }
  } else {
    // texto (ou imagem/video sem anexo configurado)
    sent = await enviarMensagem({
      conversationId: lead.chatwoot_conversation_id,
      content: texto,
    });
  }

  if ("error" in sent) {
    return { error: `envio falhou: ${sent.error}` };
  }

  // Atualiza tracking — proximo agendamento ou termino do ciclo
  const proximaRegra = regrasAtivas.find((r) => r.nivel === proximoNivel + 1);
  const proximoEm = proximaRegra
    ? calcularProximoEm(
        proximaRegra.esperar_dias,
        proximaRegra.esperar_horas,
        proximaRegra.esperar_minutos ?? 0,
      )
    : null;

  const update: Record<string, unknown> = {
    numero_followup: proximoNivel,
    ultimo_followup_em: new Date().toISOString(),
    proximo_followup_em: proximoEm?.toISOString() ?? null,
  };
  // So muda pra status "followup" se atingiu o gatilho configurado da org.
  // Antes disso, mantem o status atual (em_conversa, novo_lead, etc).
  if (
    proximoNivel >= mudarStatusAPartir &&
    (lead.status === "novo_lead" || lead.status === "em_conversa")
  ) {
    update.status = "followup";
  }

  // Se essa foi a ultima regra ativa, encerra ciclo (desistencia ou reativacao)
  if (!proximaRegra) {
    const regrasReatAtivas = config.reativacao.regras.filter((r) => r.ativo);
    const primeiraReat = regrasReatAtivas[0];
    if (config.reativacao.ativa && primeiraReat) {
      // Agenda a primeira regra de reativacao — quando o tempo passar,
      // processarFimRegras envia. numero_reativacao continua 0 ate o disparo.
      update.proximo_followup_em = calcularProximoEm(
        primeiraReat.esperar_dias,
        primeiraReat.esperar_horas,
        primeiraReat.esperar_minutos,
      ).toISOString();
      // Mantem status — ainda nao "perdeu" ate as reativacoes falharem
    } else {
      update.status = "perdido";
      update.proximo_followup_em = null;
    }
  }

  await supabase.from("leads").update(update).eq("id", lead.id);

  await logarEvento({
    leadId: lead.id,
    organizationId: lead.organization_id,
    tipo: "followup_enviado",
    descricao: `Follow-up nº${proximoNivel} enviado${regra.usa_ia ? " (gerado por IA)" : ""}`,
    autorNome: "Caio (automático)",
    meta: { nivel: proximoNivel, usa_ia: regra.usa_ia },
  });

  return { ok: true, acao: "followup" };
}

/**
 * Chamado quando o followup principal esgotou e o lead esta em fase de
 * reativacao. Itera nas regras de reativacao usando lead.numero_reativacao.
 *
 * - numero_reativacao = 0 → vai disparar a primeira regra agora
 * - cada disparo incrementa numero_reativacao
 * - quando acaba a lista, marca como "perdido"
 */
async function processarFimRegras(
  lead: LeadProcess,
  config: FollowupConfig,
): Promise<{ ok: true; acao: "reativacao" | "desistencia" }> {
  const supabase = createAdminClient();
  const reat = config.reativacao;

  if (!reat?.ativa || !lead.chatwoot_conversation_id) {
    await supabase
      .from("leads")
      .update({ status: "perdido", proximo_followup_em: null })
      .eq("id", lead.id);
    return { ok: true, acao: "desistencia" };
  }

  const regrasReatAtivas = reat.regras.filter((r) => r.ativo);
  const proximoNivelReat = (lead.numero_reativacao ?? 0) + 1;
  const regra = regrasReatAtivas.find((r) => r.nivel === proximoNivelReat);

  if (!regra) {
    // Sem proxima regra de reativacao → desistiu de vez
    await supabase
      .from("leads")
      .update({ status: "perdido", proximo_followup_em: null })
      .eq("id", lead.id);
    return { ok: true, acao: "desistencia" };
  }

  // Envia mensagem (IA ou template)
  let texto: string;
  if (regra.usa_ia) {
    const result = await gerarRespostaCaio({ leadId: lead.id });
    if ("error" in result) {
      texto = aplicarTemplate(regra.mensagem, lead);
    } else {
      texto = result.resposta;
    }
  } else {
    texto = aplicarTemplate(regra.mensagem, lead);
  }

  // Importacao lazy do helper de midia pra evitar import circular
  const { enviarComMidia } = await import("./enviar-com-midia");
  await enviarComMidia({
    conversationId: lead.chatwoot_conversation_id,
    organizationId: lead.organization_id,
    texto,
    tipoMidia: regra.tipo_midia ?? "texto",
    attachmentUrl: regra.attachment_url ?? null,
    attachmentMime: regra.attachment_mime ?? null,
  });

  // Agenda proxima regra de reativacao, ou marca perdido se foi a ultima
  const proximaRegra = regrasReatAtivas.find(
    (r) => r.nivel === proximoNivelReat + 1,
  );
  const update: Record<string, unknown> = {
    numero_reativacao: proximoNivelReat,
    ultimo_followup_em: new Date().toISOString(),
  };
  if (proximaRegra) {
    update.proximo_followup_em = calcularProximoEm(
      proximaRegra.esperar_dias,
      proximaRegra.esperar_horas,
      proximaRegra.esperar_minutos,
    ).toISOString();
  } else {
    update.proximo_followup_em = null;
    update.status = "perdido";
  }

  await supabase.from("leads").update(update).eq("id", lead.id);

  await logarEvento({
    leadId: lead.id,
    organizationId: lead.organization_id,
    tipo: "reativacao_enviada",
    descricao: `Reativação nº${proximoNivelReat} enviada${proximaRegra ? "" : " — lead marcado como perdido"}`,
    autorNome: "Caio (automático)",
    meta: { nivel: proximoNivelReat, usa_ia: regra.usa_ia },
  });

  return { ok: true, acao: "reativacao" };
}

/**
 * Busca todos os leads com followup pendente e processa.
 * Chamado pelo endpoint /api/cron/followup que e disparado pelo crontab.
 */
export async function processarFollowupsPendentes(): Promise<{
  total: number;
  ok: number;
  erros: number;
}> {
  const supabase = createAdminClient();

  const { data: leads, error } = await supabase
    .from("leads")
    .select(
      "id, nome, telefone, status, organization_id, numero_followup, numero_reativacao, chatwoot_conversation_id, caio_ativo, followup_ativo, ultimo_followup_em, origem",
    )
    .eq("caio_ativo", true)
    .eq("followup_ativo", true)
    .not("proximo_followup_em", "is", null)
    .lte("proximo_followup_em", new Date().toISOString())
    .limit(50); // safety cap por execucao

  if (error || !leads) {
    console.error("[followup:cron]", "erro buscando leads:", error?.message);
    return { total: 0, ok: 0, erros: 0 };
  }

  let okCount = 0;
  let erroCount = 0;
  for (const lead of leads) {
    try {
      const result = await processarFollowupLead(lead);
      if ("error" in result) {
        console.error("[followup:cron]", lead.id, result.error);
        erroCount++;
      } else {
        console.log("[followup:cron]", lead.id, result.acao);
        okCount++;
      }
    } catch (err) {
      console.error("[followup:cron]", lead.id, err);
      erroCount++;
    }
  }

  return { total: leads.length, ok: okCount, erros: erroCount };
}
