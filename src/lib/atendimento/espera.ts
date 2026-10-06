/**
 * Rotina automática de 1 em 1 minuto (cron):
 *
 * 1. Mensagem de espera: se o cliente está esperando uma atendente há alguns
 *    minutos, o assistente avisa que já vão responder (no máximo 2 vezes).
 *    Só para conversas em que o assistente participou (número com assistente
 *    desligado ou fora do modo teste não recebe mensagem do "assistente").
 * 2. Rede de segurança: se uma mensagem do cliente ficou sem resposta do
 *    assistente por mais de 3 minutos (servidor reiniciou, falha da IA...), a
 *    conversa vai para a fila das atendentes. Ninguém fica sem atendimento.
 */
import { createAdminClient } from "@/lib/supabase/admin";
import { ORG_ID } from "@/lib/caio/config";
import { enviarTexto } from "./whatsapp";
import { MENSAGENS_ESPERA, avisoDeEsperaDevido, normalizarConfig } from "./regras";

export async function enviarMensagensDeEspera(): Promise<{ enviadas: number; resgatados: number }> {
  const admin = createAdminClient();
  const { data: org } = await admin.from("organizations").select("atendimento_config").eq("id", ORG_ID).maybeSingle();
  const cfg = normalizarConfig(org?.atendimento_config);
  const agora = new Date();

  // 2) Rede de segurança: conversas presas com o assistente.
  const limite = new Date(agora.getTime() - 3 * 60_000).toISOString();
  const { data: presos } = await admin
    .from("leads")
    .select("id, ultima_msg_lead_em, assistente_viu_ate")
    .eq("organization_id", ORG_ID)
    .eq("atend_status", "bot")
    .lt("ultima_msg_lead_em", limite)
    .limit(100);
  let resgatados = 0;
  for (const l of presos ?? []) {
    const semResposta = !l.assistente_viu_ate || new Date(l.ultima_msg_lead_em).getTime() > new Date(l.assistente_viu_ate).getTime();
    if (!semResposta) continue;
    const { data: mudou } = await admin
      .from("leads")
      .update({ atend_status: "aguardando", aguardando_desde: agora.toISOString(), avisos_espera: 0, ultimo_aviso_em: null })
      .eq("id", l.id)
      .eq("atend_status", "bot")
      .select("id");
    if (mudou?.length) resgatados++;
  }

  // 1) Mensagens de espera.
  if (!cfg.assistente_ativo) return { enviadas: 0, resgatados };
  const { data: leads } = await admin
    .from("leads")
    .select("id, aguardando_desde, avisos_espera, ultimo_aviso_em, respostas_bot")
    .eq("organization_id", ORG_ID)
    .eq("atend_status", "aguardando")
    .gt("respostas_bot", 0)
    .not("aguardando_desde", "is", null)
    .limit(100);

  let enviadas = 0;
  for (const l of leads ?? []) {
    const indice = avisoDeEsperaDevido(l.aguardando_desde, l.avisos_espera ?? 0, l.ultimo_aviso_em, cfg, agora);
    if (indice === null) continue;
    // Reserva antes de enviar: se a rotina rodar duas vezes ao mesmo tempo, só uma manda.
    const { data: reservado } = await admin
      .from("leads")
      .update({ avisos_espera: indice + 1, ultimo_aviso_em: agora.toISOString() })
      .eq("id", l.id)
      .eq("atend_status", "aguardando")
      .eq("avisos_espera", indice)
      .select("id");
    if (!reservado?.length) continue;
    const texto = MENSAGENS_ESPERA[Math.min(indice, MENSAGENS_ESPERA.length - 1)];
    const r = await enviarTexto({ leadId: l.id, texto, autor: "assistente", remetenteNome: "Assistente" });
    if ("error" in r) console.warn("[espera] envio falhou:", l.id, r.error);
    else enviadas++;
  }
  return { enviadas, resgatados };
}
