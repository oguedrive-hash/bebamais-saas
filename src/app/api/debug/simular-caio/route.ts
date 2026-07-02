/**
 * Endpoint de simulação: roda o mesmo fluxo que o webhook handler do
 * Chatwoot rodaria para uma mensagem incoming, mas SEM enviar pelo Chatwoot.
 * Retorna o que o Caio responderia + qual caminho ativou.
 *
 * Uso (via curl):
 *   POST /api/debug/simular-caio
 *   Authorization: Bearer <CRON_SECRET>
 *   {
 *     "orgId": "455b9a80-6bb9-461b-b62d-188f0a28c110",
 *     "telefone": "+5519998744971",
 *     "nome": "Lucas Teste",
 *     "texto": "Quero agendar a retirada",
 *     "limparHistorico": false
 *   }
 *
 * Cada chamada APENDA a msg como incoming, calcula a resposta, INSERE a
 * resposta no histórico como outgoing (pra próxima chamada ter contexto).
 * Nada vai pro Chatwoot.
 */

import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { gerarRespostaCaio } from "@/lib/caio/gerar-resposta";
import { classificarAceite } from "@/lib/caio/classificador-aceite";
import { classificarAdiamento } from "@/lib/caio/classificador-adiamento";
import { classificarHandoff } from "@/lib/caio/classificador-handoff";
import { dispararHandoff } from "@/lib/caio/handoff";
import { tentarAgendar } from "@/lib/caio/tentar-agendar";
import { calcularSlotsLivres } from "@/lib/caio/slots-livres";
import {
  gerarLinhaHorariosDoDia,
  tentarResponderDisponibilidade,
} from "@/lib/caio/resposta-disponibilidade";

const NOMES_DIAS_LISTA = [
  "",
  "segunda",
  "terça",
  "quarta",
  "quinta",
  "sexta",
  "sábado",
  "domingo",
];

function descreverDiasNatural(dias: number[]): string {
  if (dias.length === 7) return "todos os dias da semana";
  if (
    dias.length === 5 &&
    [1, 2, 3, 4, 5].every((d) => dias.includes(d))
  ) {
    return "de segunda a sexta";
  }
  const nomes = dias.map((d) => NOMES_DIAS_LISTA[d]).filter(Boolean);
  if (nomes.length === 1) return nomes[0];
  if (nomes.length === 2) return nomes.join(" e ");
  return nomes.slice(0, -1).join(", ") + " e " + nomes[nomes.length - 1];
}

export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET não configurado" }, { status: 500 });
  }
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as {
    orgId: string;
    telefone: string;
    nome?: string;
    texto: string;
    limparHistorico?: boolean;
  };

  if (!body.orgId || !body.telefone || !body.texto) {
    return NextResponse.json(
      { error: "orgId, telefone e texto são obrigatórios" },
      { status: 400 },
    );
  }

  const admin = createAdminClient();

  // 1. Cria/busca o lead
  let { data: lead } = await admin
    .from("leads")
    .select("id, nome, organization_id, chatwoot_conversation_id")
    .eq("organization_id", body.orgId)
    .eq("telefone", body.telefone)
    .maybeSingle();

  if (!lead) {
    const { data: novo } = await admin
      .from("leads")
      .insert({
        organization_id: body.orgId,
        telefone: body.telefone,
        nome: body.nome ?? "Sim Teste",
        status: "em_conversa",
        origem: "inbound",
        origem_inicial: "inbound",
        caio_ativo: true,
        chatwoot_conversation_id: 999999,
      })
      .select("id, nome, organization_id, chatwoot_conversation_id")
      .single();
    lead = novo;
  }
  if (!lead) {
    return NextResponse.json({ error: "Falha ao criar lead" }, { status: 500 });
  }

  // Opcional: limpa histórico do lead (mensagens e eventos)
  if (body.limparHistorico) {
    await admin.from("mensagens").delete().eq("lead_id", lead.id);
    await admin.from("lead_eventos").delete().eq("lead_id", lead.id);
  }

  // 2. Insere a msg como incoming
  await admin.from("mensagens").insert({
    organization_id: body.orgId,
    lead_id: lead.id,
    conteudo: body.texto,
    direcao: "entrada",
    tipo: "texto",
    chatwoot_message_id: Date.now(),
  });

  // 3. Roda os atalhos do webhook handler
  //    Caminho A: resposta determinística sobre disponibilidade
  const respDisp = await tentarResponderDisponibilidade({
    organizationId: body.orgId,
    conteudoLead: body.texto,
    nomeLead: lead.nome ?? null,
  });
  if (respDisp) {
    await admin.from("mensagens").insert({
      organization_id: body.orgId,
      lead_id: lead.id,
      conteudo: respDisp,
      direcao: "saida",
      tipo: "texto",
      chatwoot_message_id: Date.now() + 1,
    });
    return NextResponse.json({
      caminho: "disponibilidade",
      resposta: respDisp,
    });
  }

  //    Caminho A.5: HANDOFF — reagendar/cancelar, irritado ou pede humano
  const { data: msgsHandoff } = await admin
    .from("mensagens")
    .select("direcao, conteudo")
    .eq("lead_id", lead.id)
    .eq("shadow", false)
    .order("created_at", { ascending: false })
    .limit(6);
  const contextoHandoff = (msgsHandoff ?? [])
    .reverse()
    .map((m) => `${m.direcao === "entrada" ? "Lead" : "Caio"}: ${m.conteudo}`)
    .join("\n");
  const classifHandoff = await classificarHandoff({
    ultimaMensagem: body.texto,
    contextoAnterior: contextoHandoff,
  });
  // muda_reuniao so faz sentido se ja existe agendamento — senao "marcar
  // retirada" / "as 10:30" sao falsos positivos.
  let handoffAtivo = classifHandoff.intencao !== "nenhum";
  if (handoffAtivo && classifHandoff.intencao === "muda_reuniao") {
    const { data: agExistente } = await admin
      .from("agendamentos")
      .select("id")
      .eq("lead_id", lead.id)
      .eq("status", "agendado")
      .gte("data_inicio", new Date().toISOString())
      .limit(1)
      .maybeSingle();
    if (!agExistente) handoffAtivo = false;
  }
  if (handoffAtivo && classifHandoff.intencao !== "nenhum") {
    const { texto } = await dispararHandoff({
      organizationId: body.orgId,
      leadId: lead.id,
      leadNome: lead.nome ?? null,
      leadTelefone: body.telefone,
      motivo: classifHandoff.intencao,
      ultimaMsg: body.texto,
    });
    await admin.from("mensagens").insert({
      organization_id: body.orgId,
      lead_id: lead.id,
      conteudo: texto,
      direcao: "saida",
      tipo: "texto",
      chatwoot_message_id: Date.now() + 1,
    });
    return NextResponse.json({
      caminho: "handoff",
      motivo: classifHandoff.intencao,
      resposta: texto,
    });
  }

  //    Caminho B: aceite (com horário, sem horário, etc)
  //    Se lead ja tem agendamento futuro, pula classificador — "Pode sim" no
  //    contexto de lembrete nao deve criar agendamento novo.
  const { data: agendamentoExistente } = await admin
    .from("agendamentos")
    .select("id, data_inicio")
    .eq("lead_id", lead.id)
    .eq("status", "agendado")
    .gte("data_inicio", new Date().toISOString())
    .order("data_inicio", { ascending: true })
    .limit(1)
    .maybeSingle();

  const { data: msgs } = await admin
    .from("mensagens")
    .select("direcao, conteudo")
    .eq("lead_id", lead.id)
    .eq("shadow", false)
    .order("created_at", { ascending: false })
    .limit(6);
  const contexto = (msgs ?? [])
    .reverse()
    .map((m) => `${m.direcao === "entrada" ? "Lead" : "Caio"}: ${m.conteudo}`)
    .join("\n");
  const classifAceite = agendamentoExistente
    ? { intencao: "responde_normal" as const }
    : await classificarAceite({
        ultimaMensagem: body.texto,
        contextoAnterior: contexto,
      });

  if (classifAceite.intencao === "aceita_com_horario") {
    const momento = new Date(classifAceite.momento_iso);
    const result = await tentarAgendar({
      organizationId: body.orgId,
      leadId: lead.id,
      momento,
    });
    if ("ok" in result) {
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
      const respLLM = await gerarRespostaCaio({
        leadId: lead.id,
        extrasContexto: [
          `[AGENDAMENTO CRIADO] O cliente acabou de aceitar agendar a retirada e o agendamento JÁ FOI CRIADO pra: ${dataStr}. Confirme curto e natural.`,
        ],
      });
      const texto = "error" in respLLM ? `[erro LLM: ${respLLM.error}]` : respLLM.resposta;
      await admin.from("mensagens").insert({
        organization_id: body.orgId,
        lead_id: lead.id,
        conteudo: texto,
        direcao: "saida",
        tipo: "texto",
        chatwoot_message_id: Date.now() + 1,
      });
      return NextResponse.json({
        caminho: "aceita_com_horario_ok",
        agendamento: result.agendamento,
        resposta: texto,
      });
    }
    // Falha: resposta determinística
    const horaPedida = new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: "America/Sao_Paulo",
    }).format(momento);
    const buscaHora = await calcularSlotsLivres({
      organizationId: body.orgId,
      qtdMaxima: 5,
      filtrarPorHora: horaPedida,
    });
    const temMesmaHora = "slots" in buscaHora && buscaHora.slots.length > 0;
    const primeiroNome = lead.nome?.split(" ")[0] ?? null;
    const sauda = primeiroNome ? `${primeiroNome}, ` : "";

    const wdPedido = new Intl.DateTimeFormat("en-US", {
      weekday: "short",
      timeZone: "America/Sao_Paulo",
    }).format(momento);
    const mapWd: Record<string, number> = {
      Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7,
    };
    const diaPedidoNum = mapWd[wdPedido] ?? 0;
    const nomeDiaPedido = NOMES_DIAS_LISTA[diaPedidoNum] ?? "esse dia";

    let respFalha: string;
    if (result.motivo === "dia_nao_atendido") {
      respFalha = `${sauda}${nomeDiaPedido} a gente não atende. Qual outro dia da semana funciona melhor pra você?`;
    } else if (result.motivo === "fora_horizonte") {
      respFalha = `${sauda}essa data está muito distante. Pode escolher outro dia da semana mais próximo?`;
    } else if (result.motivo === "antes_antecedencia") {
      respFalha = `${sauda}preciso de pelo menos algumas horas de antecedência. Qual outro dia funciona pra você?`;
    } else if (temMesmaHora) {
      respFalha = `${sauda}esse horário não está disponível na ${nomeDiaPedido}, mas tenho o mesmo horário (${horaPedida}) em outro dia. Qual dia da semana fica melhor pra você?`;
    } else {
      const linha =
        diaPedidoNum > 0
          ? await gerarLinhaHorariosDoDia({
              organizationId: body.orgId,
              diaSemana: diaPedidoNum,
            })
          : null;
      respFalha = linha
        ? `${sauda}o horário ${horaPedida} não está disponível na ${nomeDiaPedido}. ${linha}`
        : `${sauda}esse horário não está disponível. Qual outro dia da semana funciona melhor pra você?`;
    }
    await admin.from("mensagens").insert({
      organization_id: body.orgId,
      lead_id: lead.id,
      conteudo: respFalha,
      direcao: "saida",
      tipo: "texto",
      chatwoot_message_id: Date.now() + 1,
    });
    return NextResponse.json({
      caminho: "aceita_com_horario_falha",
      motivo: result.motivo,
      resposta: respFalha,
    });
  }

  if (classifAceite.intencao === "aceita_sem_horario") {
    const { data: orgInfo } = await admin
      .from("organizations")
      .select("agenda_config")
      .eq("id", body.orgId)
      .single();
    const cfg = orgInfo?.agenda_config as { dias_semana?: number[] } | null;
    const diasDesc = descreverDiasNatural(cfg?.dias_semana ?? [1, 2, 3, 4, 5]);
    const primeiroNome = lead.nome?.split(" ")[0] ?? null;
    const nome = primeiroNome ? `, ${primeiroNome}` : "";
    const texto = `Perfeito${nome}! Que dia fica melhor pra você buscar? A gente atende ${diasDesc}.`;
    await admin.from("mensagens").insert({
      organization_id: body.orgId,
      lead_id: lead.id,
      conteudo: texto,
      direcao: "saida",
      tipo: "texto",
      chatwoot_message_id: Date.now() + 1,
    });
    return NextResponse.json({
      caminho: "aceita_sem_horario",
      resposta: texto,
    });
  }

  //    Caminho C: adiamento
  const classifAdi = await classificarAdiamento({
    ultimaMensagem: body.texto,
    contextoAnterior: contexto,
    aguardandoResposta: false,
  });
  if (classifAdi.intencao !== "responde_normal") {
    return NextResponse.json({
      caminho: "adiamento",
      classificacao: classifAdi,
      resposta: "(adiamento — fluxo do webhook handler responde, não simulado aqui)",
    });
  }

  //    Caminho D: resposta normal via LLM
  const respLLM = await gerarRespostaCaio({ leadId: lead.id });
  const texto = "error" in respLLM ? `[erro LLM: ${respLLM.error}]` : respLLM.resposta;
  await admin.from("mensagens").insert({
    organization_id: body.orgId,
    lead_id: lead.id,
    conteudo: texto,
    direcao: "saida",
    tipo: "texto",
    chatwoot_message_id: Date.now() + 1,
  });
  return NextResponse.json({
    caminho: "llm_normal",
    resposta: texto,
  });
}
