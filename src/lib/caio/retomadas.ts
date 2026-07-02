/**
 * Worker de retomadas — leads com proximo_contato_em vencido.
 *
 * Quando lead pediu adiamento e marcou data, esse worker dispara a msg de
 * retomada (template configurado em organizations.mensagem_retomada) na hora
 * combinada e re-engata o fluxo apropriado:
 *
 *  - Lead inbound OU lead de prospeccao que ja respondeu → status em_conversa,
 *    agenda 1a regra de followup (inbound config ou prospeccao followup config
 *    conforme origem)
 *
 *  - Lead de prospeccao que NUNCA respondeu (so pediu adiamento) → volta pra
 *    em_prospeccao (ou aguardando_primeiro_contato se ainda nem disparou a 1a),
 *    agenda proxima regra da cadencia outbound respeitando janela
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { gerarRespostaCaio } from "@/lib/caio/gerar-resposta";
import { logarEvento } from "@/lib/caio/eventos";
import { podeEnviarProativo } from "@/lib/caio/guardrails";
import {
  enviarComMidia,
  type TipoMidia,
} from "@/lib/caio/enviar-com-midia";

type RegraSimples = {
  nivel: number;
  esperar_dias: number;
  esperar_horas: number;
  esperar_minutos: number;
  ativo: boolean;
};

function aplicarTemplate(msg: string, nome: string | null): string {
  const primeiro = nome?.split(" ")[0] || "tudo bem";
  return msg.replace(/\{nome\}/g, primeiro);
}

export async function processarRetomadasPendentes(): Promise<{
  total: number;
  enviados: number;
  erros: number;
}> {
  const supabase = createAdminClient();

  // IMPORTANTE: filtra por status="contatar_futuramente" pra nao pegar leads
  // de prospecao que tem proximo_contato_em setado pra proxima regra da
  // cadencia outbound (esses sao processados pelo worker de prospeccao).
  const { data: leads, error } = await supabase
    .from("leads")
    .select(
      "id, nome, organization_id, chatwoot_conversation_id, caio_ativo, origem, numero_prospeccao, ultima_msg_lead_em, evolution_instance",
    )
    .eq("caio_ativo", true)
    .eq("status", "contatar_futuramente")
    .eq("opt_out", false) // guardrail: não retoma quem pediu pra parar
    .not("proximo_contato_em", "is", null)
    .lte("proximo_contato_em", new Date().toISOString())
    .limit(50);

  if (error || !leads) {
    console.error("[retomadas:cron]", "erro buscando:", error?.message);
    return { total: 0, enviados: 0, erros: 0 };
  }

  let enviadosCount = 0;
  let errosCount = 0;

  for (const lead of leads) {
    if (!lead.chatwoot_conversation_id) continue;

    // GUARDRAIL anti-ban: teto de envios proativos/hora por número. Se estourou,
    // adia ~20min essa retomada (espaça, não perde).
    if (!podeEnviarProativo((lead as { evolution_instance?: string | null }).evolution_instance)) {
      await supabase
        .from("leads")
        .update({ proximo_contato_em: new Date(Date.now() + 20 * 60_000).toISOString() })
        .eq("id", lead.id);
      continue;
    }

    // Le configs da org de uma vez (retomada + followups + prospeccao)
    const { data: org } = await supabase
      .from("organizations")
      .select(
        "mensagem_retomada, mensagem_retomada_usa_ia, mensagem_retomada_tipo_midia, mensagem_retomada_attachment_url, mensagem_retomada_attachment_mime, followup_config, prospeccao_config, prospeccao_followup_config, prospeccao_janela",
      )
      .eq("id", lead.organization_id)
      .single();

    const usaIa = org?.mensagem_retomada_usa_ia ?? true;
    const template =
      org?.mensagem_retomada ??
      "Oi {nome}! Conforme combinamos, voltando ao contato. Posso te ajudar?";

    let texto: string;
    if (usaIa) {
      const result = await gerarRespostaCaio({ leadId: lead.id });
      if ("error" in result) {
        texto = aplicarTemplate(template, lead.nome);
      } else {
        texto = result.resposta;
      }
    } else {
      texto = aplicarTemplate(template, lead.nome);
    }

    const tipoMidia = (org?.mensagem_retomada_tipo_midia ??
      "texto") as TipoMidia;
    const sent = await enviarComMidia({
      conversationId: lead.chatwoot_conversation_id,
      organizationId: lead.organization_id,
      texto,
      tipoMidia,
      attachmentUrl: org?.mensagem_retomada_attachment_url ?? null,
      attachmentMime: org?.mensagem_retomada_attachment_mime ?? null,
    });
    if ("error" in sent) {
      console.error("[retomadas:cron]", lead.id, sent.error);
      errosCount++;
      continue;
    }

    // Decide pra qual fluxo o lead volta:
    //  - prospeccao que nunca respondeu → continua cadencia outbound
    //  - resto (inbound ou prospeccao que ja respondeu) → em_conversa + followup
    const ehProspeccaoSemResposta =
      lead.origem === "prospeccao" && lead.ultima_msg_lead_em == null;

    if (ehProspeccaoSemResposta) {
      // Volta pra cadencia outbound. Agenda proxima regra dela.
      const cadenciaProsp = org?.prospeccao_config as
        | { regras?: RegraSimples[] }
        | null;
      const proxNivel = (lead.numero_prospeccao ?? 0) + 1;
      const proxRegra = (cadenciaProsp?.regras ?? []).find(
        (r) => r.ativo && r.nivel === proxNivel,
      );
      let proximoContatoEm: string | null = null;
      let statusNovo = "em_prospeccao";
      if (proxRegra) {
        const desejado = new Date();
        desejado.setDate(desejado.getDate() + (proxRegra.esperar_dias ?? 0));
        desejado.setHours(
          desejado.getHours() + (proxRegra.esperar_horas ?? 0),
          desejado.getMinutes() + (proxRegra.esperar_minutos ?? 0),
          0,
          0,
        );
        proximoContatoEm = desejado.toISOString();
      }
      // Se ainda nao tinha disparado nenhuma msg de prospeccao, mantem em
      // aguardando_primeiro_contato.
      if ((lead.numero_prospeccao ?? 0) === 0) {
        statusNovo = "aguardando_primeiro_contato";
      }
      await supabase
        .from("leads")
        .update({
          proximo_contato_em: proximoContatoEm,
          status: statusNovo,
          followup_ativo: true,
          // Followup inbound zerado — esse lead nao ta no fluxo inbound
          numero_followup: 0,
          numero_reativacao: 0,
          proximo_followup_em: null,
        })
        .eq("id", lead.id);
    } else {
      // Fluxo inbound (ou prospeccao que ja respondeu): vai pra em_conversa
      // + agenda 1a regra de followup. Origem decide qual config usar.
      const ehProspeccao = lead.origem === "prospeccao";
      const configProsp = org?.prospeccao_followup_config as
        | { regras?: RegraSimples[] }
        | null;
      const configInbound = org?.followup_config as
        | { regras?: RegraSimples[] }
        | null;
      const usaProsp =
        ehProspeccao && (configProsp?.regras?.length ?? 0) > 0;
      const config = usaProsp ? configProsp : configInbound;
      const r1 = config?.regras?.find((r) => r.ativo && r.nivel === 1);
      let proximoFollowupEm: string | null = null;
      if (r1) {
        const d = new Date();
        d.setDate(d.getDate() + (r1.esperar_dias ?? 0));
        d.setHours(d.getHours() + (r1.esperar_horas ?? 0));
        d.setMinutes(d.getMinutes() + (r1.esperar_minutos ?? 0));
        proximoFollowupEm = d.toISOString();
      }
      await supabase
        .from("leads")
        .update({
          proximo_contato_em: null,
          status: "em_conversa",
          followup_ativo: true,
          numero_followup: 0,
          numero_reativacao: 0,
          proximo_followup_em: proximoFollowupEm,
        })
        .eq("id", lead.id);
    }

    await logarEvento({
      leadId: lead.id,
      organizationId: lead.organization_id,
      tipo: "lembrete_enviado",
      descricao: "Msg de retomada enviada (data combinada chegou)",
      autorNome: "Atendente IA (automático)",
    });

    enviadosCount++;
    console.log("[retomadas:cron]", lead.id, "enviado");
  }

  return { total: leads.length, enviados: enviadosCount, erros: errosCount };
}
