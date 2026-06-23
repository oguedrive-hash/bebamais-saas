/**
 * Notifica o admin (ADMIN_WHATSAPP_NUMBER) via Evolution (envio direto pelo
 * número, sem Chatwoot). Não é fatal — se falhar, só loga e segue.
 */
import { evoSendText } from "@/lib/caio/evolution-api";
import { enviarSerializado } from "@/lib/caio/fila-envio";
import { numeroPorPapel } from "@/lib/caio/numeros";

// Avisos ao admin saem pelo número de ATENDIMENTO do pool (fallback "facilita").
async function instanciaAtendimento(orgId: string): Promise<string> {
  return (await numeroPorPapel(orgId, "atendimento"))?.instance_name ?? "facilita";
}

export async function notificarAdminFalha(opts: {
  organizationId: string;
  leadNome: string | null;
  leadTelefone: string;
  conteudoLead: string | null;
  erro: string;
}): Promise<void> {
  const adminNumero = process.env.ADMIN_WHATSAPP_NUMBER?.trim();
  if (!adminNumero) {
    console.warn("[notificar-admin] ADMIN_WHATSAPP_NUMBER não configurado — pulando");
    return;
  }
  try {
    const leadLabel = opts.leadNome ? `${opts.leadNome} (${opts.leadTelefone})` : opts.leadTelefone;
    const recorte = opts.conteudoLead?.slice(0, 200) ?? "(sem conteúdo)";
    const texto = `🚨 *Caio precisou de ajuda*\n\nLead: ${leadLabel}\nÚltima msg dele: "${recorte}"\n\nErro: ${opts.erro}\n\nResponda esse lead manualmente pelo painel.`;
    const instance = await instanciaAtendimento(opts.organizationId);
    const sent = await enviarSerializado("org:" + opts.organizationId, () =>
      evoSendText({ instance, telefone: adminNumero, texto }),
    );
    if ("error" in sent) {
      console.warn("[notificar-admin] falha ao enviar:", sent.error);
      return;
    }
    console.log("[notificar-admin] admin notificado sobre", opts.leadTelefone);
  } catch (err) {
    console.warn("[notificar-admin] erro inesperado:", err instanceof Error ? err.message : String(err));
  }
}

export async function notificarAdminAgendamento(opts: {
  organizationId: string;
  leadId: string;
  leadNome: string | null;
  leadTelefone: string;
  dataInicio: string;
  resumoIA?: string | null;
}): Promise<void> {
  const adminNumero = process.env.ADMIN_WHATSAPP_NUMBER?.trim();
  if (!adminNumero) {
    console.warn("[notificar-admin:agendamento] ADMIN_WHATSAPP_NUMBER nao configurado");
    return;
  }
  try {
    const data = new Date(opts.dataInicio);
    const dataStr = data.toLocaleString("pt-BR", { weekday: "long", day: "2-digit", month: "long", hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });
    const leadLabel = opts.leadNome ? `${opts.leadNome} (${opts.leadTelefone})` : opts.leadTelefone;
    const resumoBloco = opts.resumoIA?.trim() ? `\n\n*Contexto rapido:*\n${opts.resumoIA.trim()}` : "";
    const texto = `🟢 *Caio agendou uma sessao*\n\nLead: ${leadLabel}\nQuando: ${dataStr}${resumoBloco}\n\nConversa: https://app.facilitaplus.com.br/dashboard/contatos/${opts.leadId}`;
    const instance = await instanciaAtendimento(opts.organizationId);
    const sent = await enviarSerializado("org:" + opts.organizationId, () =>
      evoSendText({ instance, telefone: adminNumero, texto }),
    );
    if ("error" in sent) {
      console.warn("[notificar-admin:agendamento] falha enviar:", sent.error);
      return;
    }
    console.log("[notificar-admin:agendamento] admin notificado:", opts.leadTelefone, dataStr);
  } catch (err) {
    console.warn("[notificar-admin:agendamento] erro:", err instanceof Error ? err.message : String(err));
  }
}

export async function notificarAdminHandoff(opts: {
  organizationId: string;
  leadNome: string | null;
  leadTelefone: string;
  conteudoLead: string | null;
  motivo: "muda_reuniao" | "irritado" | "pede_humano";
}): Promise<void> {
  const adminNumero = process.env.ADMIN_WHATSAPP_NUMBER?.trim();
  if (!adminNumero) {
    console.warn("[notificar-admin:handoff] ADMIN_WHATSAPP_NUMBER nao configurado");
    return;
  }
  const motivoTexto = opts.motivo === "muda_reuniao" ? "quer reagendar ou cancelar a reuniao" : opts.motivo === "irritado" ? "demonstrou irritacao/frustracao" : "pediu falar com humano";
  try {
    const leadLabel = opts.leadNome ? `${opts.leadNome} (${opts.leadTelefone})` : opts.leadTelefone;
    const recorte = opts.conteudoLead?.slice(0, 200) ?? "(sem conteudo)";
    const texto = `🔔 *Caio passou pra voce*\n\nLead: ${leadLabel}\nMotivo: ${motivoTexto}.\nUltima msg: "${recorte}"\n\nCaio ja avisou o lead que voce vai entrar em contato. Responda pelo painel.`;
    const instance = await instanciaAtendimento(opts.organizationId);
    const sent = await enviarSerializado("org:" + opts.organizationId, () =>
      evoSendText({ instance, telefone: adminNumero, texto }),
    );
    if ("error" in sent) {
      console.warn("[notificar-admin:handoff] falha enviar:", sent.error);
      return;
    }
    console.log("[notificar-admin:handoff] admin notificado:", opts.leadTelefone, opts.motivo);
  } catch (err) {
    console.warn("[notificar-admin:handoff] erro:", err instanceof Error ? err.message : String(err));
  }
}
