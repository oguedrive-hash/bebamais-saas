/**
 * Worker de lembretes de reuniao agendada.
 *
 * Para cada agendamento status="agendado", calcula pra cada regra de
 * lembrete_reuniao_config o instante de disparo (data_inicio +/- tempo).
 * Se ja passou e a regra ainda nao foi enviada (lembretes_enviados[]),
 * gera msg, envia via Chatwoot, e marca como enviado.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { gerarRespostaCaio } from "@/lib/caio/gerar-resposta";
import { logarEvento } from "@/lib/caio/eventos";
import { INSTANCE_NAME, APP_BASE_URL } from "@/lib/caio/config";
import {
  enviarComMidia,
  type TipoMidia,
} from "@/lib/caio/enviar-com-midia";
import { evoSendText } from "@/lib/caio/evolution-api";
import { enviarSerializado } from "@/lib/caio/fila-envio";
import { numeroPorPapel } from "@/lib/caio/numeros";

type RegraLembrete = {
  nivel: number;
  quando: "antes" | "depois";
  tempo_dias: number;
  tempo_horas: number;
  tempo_minutos: number;
  mensagem: string;
  usa_ia: boolean;
  ativo: boolean;
  tipo_midia?: TipoMidia;
  attachment_url?: string | null;
  attachment_mime?: string | null;
};

type LembreteConfig = {
  regras: RegraLembrete[];
};

type AgendamentoProcess = {
  id: string;
  organization_id: string;
  lead_id: string;
  data_inicio: string;
  created_at: string;
  meet_link: string | null;
  lembretes_enviados: number[] | null;
  lembretes_admin_enviados: number[] | null;
  // Vem do join com lead
  lead: {
    id: string;
    nome: string | null;
    telefone: string;
    chatwoot_conversation_id: number | null;
  } | null;
};

// Lembretes do ADMIN (Lucas/especialista) - hardcoded fixos pra todo agendamento.
// nivel 1 = 24h antes; nivel 2 = 1h antes. Salvos em lembretes_admin_enviados[].
const LEMBRETES_ADMIN = [
  { nivel: 1, horasAntes: 24, titulo: "Reuniao amanha" },
  { nivel: 2, horasAntes: 1, titulo: "Reuniao em 1 hora" },
];

function calcularInstanteDisparo(
  dataInicio: Date,
  regra: RegraLembrete,
): Date {
  const offsetMs =
    regra.tempo_dias * 24 * 3600 * 1000 +
    regra.tempo_horas * 3600 * 1000 +
    regra.tempo_minutos * 60 * 1000;
  const sinal = regra.quando === "antes" ? -1 : 1;
  return new Date(dataInicio.getTime() + sinal * offsetMs);
}

function aplicarTemplate(
  msg: string,
  nome: string | null,
  dataInicio: Date,
  meetLink: string | null,
): string {
  const primeiroNome = nome?.split(" ")[0] || "tudo bem";
  const hora = dataInicio.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });
  const data = dataInicio.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
  });
  return msg
    .replace(/\{nome\}/g, primeiroNome)
    .replace(/\{hora\}/g, hora)
    .replace(/\{data\}/g, data)
    .replace(/\{meet_link\}/g, meetLink || "(link sendo gerado)");
}

export async function processarLembretesPendentes(): Promise<{
  total_agendamentos: number;
  enviados: number;
  erros: number;
}> {
  const supabase = createAdminClient();
  const agora = new Date();

  // Janela de busca: 7 dias antes ate o futuro proximo
  // (regra "antes" mais distante = 7 dias antes; "depois" mais distante = 1 dia depois)
  const inicioJanela = new Date(agora);
  inicioJanela.setDate(inicioJanela.getDate() - 1); // capturar "depois" recente
  const fimJanela = new Date(agora);
  fimJanela.setDate(fimJanela.getDate() + 7);

  const { data: agendamentos, error } = await supabase
    .from("agendamentos")
    .select(
      "id, organization_id, lead_id, data_inicio, created_at, meet_link, lembretes_enviados, lembretes_admin_enviados, lead:leads(id, nome, telefone, chatwoot_conversation_id)",
    )
    .eq("status", "agendado")
    .gte("data_inicio", inicioJanela.toISOString())
    .lte("data_inicio", fimJanela.toISOString())
    .limit(200);

  if (error || !agendamentos) {
    console.error("[lembrete:cron]", "erro buscando:", error?.message);
    return { total_agendamentos: 0, enviados: 0, erros: 0 };
  }

  let enviadosCount = 0;
  let errosCount = 0;

  for (const ag of agendamentos as unknown as AgendamentoProcess[]) {
    if (!ag.lead?.chatwoot_conversation_id) continue;

    // Le config da org
    const { data: org } = await supabase
      .from("organizations")
      .select("lembrete_reuniao_config")
      .eq("id", ag.organization_id)
      .single();
    const config = (org?.lembrete_reuniao_config ??
      null) as LembreteConfig | null;
    if (!config?.regras) continue;

    const dataInicio = new Date(ag.data_inicio);
    const createdAt = new Date(ag.created_at);
    const enviadosNiveis = new Set(ag.lembretes_enviados ?? []);
    // Margem de seguranca: se o agendamento foi criado MUITO em cima da
    // hora (ex: lead pediu 30min antes), nao queremos disparar lembretes
    // "antes" que ja eram passado quando o agendamento nasceu — caso contrario
    // o lead recebe "lembrete: sua reuniao e amanha" segundos depois de marcar.
    const margemMs = 5 * 60 * 1000; // 5 minutos

    for (const regra of config.regras) {
      if (!regra.ativo) continue;
      if (enviadosNiveis.has(regra.nivel)) continue;

      const instante = calcularInstanteDisparo(dataInicio, regra);
      if (instante > agora) continue; // Ainda nao chegou a hora

      // Lembrete "antes" cujo instante ja era passado quando o agendamento
      // foi criado: nao faz sentido disparar (seria imediato apos criar).
      // Marca como enviado pra nao reprocessar e segue.
      if (
        regra.quando === "antes" &&
        instante.getTime() < createdAt.getTime() - margemMs
      ) {
        const novosEnviados = [...(ag.lembretes_enviados ?? []), regra.nivel];
        await supabase
          .from("agendamentos")
          .update({ lembretes_enviados: novosEnviados })
          .eq("id", ag.id);
        enviadosNiveis.add(regra.nivel);
        console.log(
          "[lembrete:cron]",
          ag.id,
          `nivel ${regra.nivel} pulado (instante anterior ao created_at)`,
        );
        continue;
      }

      // Hora! Dispara o lembrete
      let texto: string;
      if (regra.usa_ia) {
        const result = await gerarRespostaCaio({ leadId: ag.lead_id });
        if ("error" in result) {
          texto = aplicarTemplate(
            regra.mensagem,
            ag.lead.nome,
            dataInicio,
            ag.meet_link,
          );
        } else {
          texto = result.resposta;
        }
      } else {
        texto = aplicarTemplate(
          regra.mensagem,
          ag.lead.nome,
          dataInicio,
          ag.meet_link,
        );
      }

      const sent = await enviarComMidia({
        conversationId: ag.lead.chatwoot_conversation_id,
        organizationId: ag.organization_id,
        texto,
        tipoMidia: regra.tipo_midia ?? "texto",
        attachmentUrl: regra.attachment_url ?? null,
        attachmentMime: regra.attachment_mime ?? null,
      });
      if ("error" in sent) {
        console.error(
          "[lembrete:cron]",
          ag.id,
          `nivel ${regra.nivel}`,
          sent.error,
        );
        errosCount++;
        continue;
      }

      // Marca nivel como enviado
      const novosEnviados = [...(ag.lembretes_enviados ?? []), regra.nivel];
      await supabase
        .from("agendamentos")
        .update({ lembretes_enviados: novosEnviados })
        .eq("id", ag.id);
      enviadosCount++;
      console.log("[lembrete:cron]", ag.id, `nivel ${regra.nivel} enviado`);

      await logarEvento({
        leadId: ag.lead_id,
        organizationId: ag.organization_id,
        tipo: "lembrete_enviado",
        descricao: `Lembrete de reunião nº${regra.nivel} enviado (${regra.quando})`,
        autorNome: "Caio (automático)",
        meta: { nivel: regra.nivel, agendamento_id: ag.id },
      });
    }

    // Lembretes ADMIN (Lucas) — hardcoded 24h e 1h antes.
    await processarLembretesAdmin(supabase, ag, agora);
  }

  return {
    total_agendamentos: agendamentos.length,
    enviados: enviadosCount,
    erros: errosCount,
  };
}

async function processarLembretesAdmin(
  supabase: ReturnType<typeof createAdminClient>,
  ag: AgendamentoProcess,
  agora: Date,
): Promise<void> {
  const adminNumero = process.env.ADMIN_WHATSAPP_NUMBER?.trim();
  if (!adminNumero) return;
  if (!ag.lead) return;

  const enviados = new Set(ag.lembretes_admin_enviados ?? []);
  const dataInicio = new Date(ag.data_inicio);

  for (const regra of LEMBRETES_ADMIN) {
    if (enviados.has(regra.nivel)) continue;
    const instante = new Date(
      dataInicio.getTime() - regra.horasAntes * 3600 * 1000,
    );
    if (instante > agora) continue;
    // Se o agendamento foi criado depois da hora do lembrete, pula
    // (caso lead marcou pra daqui 30min, nao faz sentido mandar lembrete
    // de 1h antes que ja era passado).
    if (instante.getTime() < new Date(ag.created_at).getTime() - 5 * 60 * 1000) {
      const atualiza = [...(ag.lembretes_admin_enviados ?? []), regra.nivel];
      await supabase
        .from("agendamentos")
        .update({ lembretes_admin_enviados: atualiza })
        .eq("id", ag.id);
      enviados.add(regra.nivel);
      continue;
    }

    try {
      const dataStr = dataInicio.toLocaleString("pt-BR", {
        weekday: "long",
        day: "2-digit",
        month: "long",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "America/Sao_Paulo",
      });
      const leadLabel = ag.lead.nome
        ? `${ag.lead.nome} (${ag.lead.telefone})`
        : ag.lead.telefone;
      const texto = `⏰ *${regra.titulo}*

Lead: ${leadLabel}
Quando: ${dataStr}

Conversa: ${APP_BASE_URL}/dashboard/contatos/${ag.lead.id}`;

      // Chatwoot desativado: envia direto pro admin via Evolution, pela esteira.
      // Sai pelo número de atendimento do pool (fallback = instância do tenant).
      const instanceAdmin =
        (await numeroPorPapel(ag.organization_id, "atendimento"))?.instance_name ?? INSTANCE_NAME;
      const sent = await enviarSerializado("org:" + ag.organization_id, () =>
        evoSendText({ instance: instanceAdmin, telefone: adminNumero, texto }),
      );
      if ("error" in sent) {
        console.warn(
          "[lembrete:admin]",
          ag.id,
          `nivel ${regra.nivel}`,
          sent.error,
        );
        continue;
      }
      const atualiza = [...(ag.lembretes_admin_enviados ?? []), regra.nivel];
      await supabase
        .from("agendamentos")
        .update({ lembretes_admin_enviados: atualiza })
        .eq("id", ag.id);
      enviados.add(regra.nivel);
      console.log(
        "[lembrete:admin]",
        ag.id,
        `nivel ${regra.nivel} enviado (${regra.titulo})`,
      );
    } catch (err) {
      console.warn(
        "[lembrete:admin] erro:",
        err instanceof Error ? err.message : String(err),
      );
    }
  }
}
