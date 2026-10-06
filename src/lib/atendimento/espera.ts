/**
 * Mensagem de espera: se o cliente está esperando uma atendente há alguns
 * minutos, o assistente avisa que já vão responder (no máximo 2 vezes).
 * Roda pela rotina automática (cron) a cada minuto.
 */
import { createAdminClient } from "@/lib/supabase/admin";
import { ORG_ID } from "@/lib/caio/config";
import { enviarTexto } from "./whatsapp";
import { MENSAGENS_ESPERA, avisoDeEsperaDevido, normalizarConfig } from "./regras";

export async function enviarMensagensDeEspera(): Promise<{ enviadas: number }> {
  const admin = createAdminClient();
  const { data: org } = await admin.from("organizations").select("atendimento_config").eq("id", ORG_ID).maybeSingle();
  const cfg = normalizarConfig(org?.atendimento_config);
  if (!cfg.assistente_ativo) return { enviadas: 0 };

  const { data: leads } = await admin
    .from("leads")
    .select("id, aguardando_desde, avisos_espera")
    .eq("organization_id", ORG_ID)
    .eq("atend_status", "aguardando")
    .not("aguardando_desde", "is", null)
    .limit(100);

  const agora = new Date();
  let enviadas = 0;
  for (const l of leads ?? []) {
    const indice = avisoDeEsperaDevido(l.aguardando_desde, l.avisos_espera ?? 0, cfg, agora);
    if (indice === null) continue;
    // Reserva antes de enviar: se a rotina rodar duas vezes ao mesmo tempo, só uma manda.
    const { data: reservado } = await admin
      .from("leads")
      .update({ avisos_espera: indice + 1 })
      .eq("id", l.id)
      .eq("atend_status", "aguardando")
      .eq("avisos_espera", indice)
      .select("id")
      .maybeSingle();
    if (!reservado) continue;
    const texto = MENSAGENS_ESPERA[Math.min(indice, MENSAGENS_ESPERA.length - 1)];
    const r = await enviarTexto({ leadId: l.id, texto, autor: "assistente", remetenteNome: "Assistente" });
    if ("error" in r) console.warn("[espera] envio falhou:", l.id, r.error);
    else enviadas++;
  }
  return { enviadas };
}
