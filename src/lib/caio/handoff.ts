/**
 * Handoff: tira o Caio da conversa e chama humano. Dispara quando:
 *  - lead pede pra reagendar/cancelar reuniao
 *  - lead esta irritado/xingando
 *  - lead pede explicitamente falar com pessoa
 *
 * Acoes:
 *  - leads.caio_ativo=false, followup_ativo=false (Caio para)
 *  - leads.precisa_humano=true + motivo + timestamp (badge no painel)
 *  - logarEvento "handoff_humano"
 *  - notificarAdminHandoff (WhatsApp pro Lucas)
 *  - devolve canned response pra mandar ao lead
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { logarEvento } from "@/lib/caio/eventos";
import { notificarAdminHandoff } from "@/lib/caio/notificar-admin";
import type { MotivoHandoff } from "@/lib/caio/classificador-handoff";

function gerarRespostaHandoff(
  motivo: MotivoHandoff,
  primeiroNome: string | null,
): string {
  const sauda = primeiroNome ? `${primeiroNome}, ` : "";
  if (motivo === "muda_reuniao") {
    return `${sauda}vou chamar nosso time pra te atender. Em alguns minutos alguem entra em contato.`;
  }
  if (motivo === "irritado") {
    return `${sauda}entendo. Vou chamar nosso time pra te atender direto. Em alguns minutos alguem entra em contato.`;
  }
  return `${sauda}claro, vou chamar nosso time pra te atender. Em alguns minutos alguem entra em contato.`;
}

export async function dispararHandoff(opts: {
  organizationId: string;
  leadId: string;
  leadNome: string | null;
  leadTelefone: string;
  motivo: MotivoHandoff;
  ultimaMsg: string;
}): Promise<{ texto: string }> {
  const supabase = createAdminClient();

  await supabase
    .from("leads")
    .update({
      caio_ativo: false,
      followup_ativo: false,
      precisa_humano: true,
      precisa_humano_motivo: opts.motivo,
      precisa_humano_em: new Date().toISOString(),
    })
    .eq("id", opts.leadId);

  await logarEvento({
    leadId: opts.leadId,
    organizationId: opts.organizationId,
    tipo: "handoff_humano",
    descricao: `Handoff disparado (${opts.motivo}). Caio off, time avisado.`,
    autorNome: "Caio (automatico)",
    meta: { motivo: opts.motivo, ultima_msg: opts.ultimaMsg.slice(0, 200) },
  });

  // Notifica Lucas no WhatsApp (nao bloqueia se falhar)
  await notificarAdminHandoff({
    organizationId: opts.organizationId,
    leadNome: opts.leadNome,
    leadTelefone: opts.leadTelefone,
    conteudoLead: opts.ultimaMsg,
    motivo: opts.motivo,
  });

  const primeiroNome = opts.leadNome?.split(" ")[0] ?? null;
  return { texto: gerarRespostaHandoff(opts.motivo, primeiroNome) };
}
