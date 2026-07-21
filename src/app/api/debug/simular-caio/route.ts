/**
 * Endpoint de simulação: roda o mesmo fluxo que o webhook handler do
 * Chatwoot rodaria para uma mensagem incoming, mas SEM enviar pelo Chatwoot.
 * Retorna o que a IA responderia + qual caminho ativou.
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
import { extrairEAtualizarPedido } from "@/lib/caio/extrator-pedido";
import { classificarHandoff } from "@/lib/caio/classificador-handoff";
import { dispararHandoff } from "@/lib/caio/handoff";
import { tentarAgendar } from "@/lib/caio/tentar-agendar";
import { tentarResponderDisponibilidade } from "@/lib/caio/resposta-disponibilidade";
import {
  AGENDA_CONFIG_DEFAULT,
  getAgendaConfig,
  janelaFuncionamento,
} from "@/lib/caio/agenda-config";

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

  // 2.5 Extrator de pedido — AWAITED aqui (diferente do fluxo real, que é
  // fire-and-forget) pra simulação ser determinística: a resposta já sai
  // com o estado do pedido pós-extração.
  try {
    await extrairEAtualizarPedido({ organizationId: body.orgId, leadId: lead.id });
  } catch (e) {
    console.warn("[simular-caio] extrator falhou:", e instanceof Error ? e.message : String(e));
  }
  const pedidoAtual = async () =>
    (
      await admin
        .from("pedidos")
        .select("id, status, itens, modalidade, endereco, nome_cliente, forma_pagamento, troco_para, agendamento_id")
        .eq("lead_id", lead.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle()
    ).data ?? null;

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
      pedido: await pedidoAtual(),
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
    .map((m) => `${m.direcao === "entrada" ? "Lead" : "Atendente"}: ${m.conteudo}`)
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
      .in("status", ["sugerido", "agendado"])
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
      pedido: await pedidoAtual(),
    });
  }

  //    Caminho B: aceite (com horário, sem horário, etc)
  //    Se lead ja tem agendamento futuro, pula classificador — "Pode sim" no
  //    contexto de lembrete nao deve criar agendamento novo.
  const { data: agendamentoExistente } = await admin
    .from("agendamentos")
    .select("id, data_inicio")
    .eq("lead_id", lead.id)
    .in("status", ["sugerido", "agendado"])
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
    .map((m) => `${m.direcao === "entrada" ? "Lead" : "Atendente"}: ${m.conteudo}`)
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
          `[HORÁRIO ANOTADO] O cliente sugeriu um horário pra retirada/entrega e ele JÁ FOI ANOTADO pra equipe: ${dataStr} (fuso de Brasília). Diga de forma natural e curta que você anotou esse horário e que a EQUIPE vai confirmar com ele. Cite data e hora exatas. NÃO diga que está "agendado" ou "confirmado" — é o horário que ele sugeriu e a equipe confirma.`,
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
        pedido: await pedidoAtual(),
      });
    }
    // Horário não serve — resposta determinística com o FUNCIONAMENTO da loja
    const func = result.funcionamento;
    const abreF = func?.abre ?? "08:00";
    const fechaF = func?.fecha ?? "18:00";
    const diasTextoF = descreverDiasNatural(func?.diasSemana ?? [1, 2, 3, 4, 5]);
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
      respFalha = `${sauda}${nomeDiaPedido} a loja não abre. Funcionamos ${diasTextoF}, das ${abreF} às ${fechaF}. Qual dia fica melhor pra você?`;
    } else if (result.motivo === "fora_horizonte") {
      respFalha = `${sauda}essa data tá um pouco distante pra eu já deixar anotada. Me diz um dia mais próximo que eu anoto pra equipe — ou me chama de novo mais perto da data, combinado?`;
    } else if (result.motivo === "no_passado") {
      respFalha = `${sauda}esse horário já passou. Me diz um dia e horário daqui pra frente? A loja abre ${diasTextoF}, das ${abreF} às ${fechaF}.`;
    } else if (result.motivo === "fora_funcionamento") {
      respFalha = `${sauda}nesse horário a loja tá fechada — funcionamos das ${abreF} às ${fechaF}. Me diz outro horário dentro desse período que eu já deixo anotado pra equipe.`;
    } else {
      respFalha = `${sauda}tive um probleminha pra anotar aqui. Pode me confirmar de novo o dia e o horário?`;
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
      pedido: await pedidoAtual(),
    });
  }

  if (classifAceite.intencao === "aceita_sem_horario") {
    const { data: orgInfo } = await admin
      .from("organizations")
      .select("agenda_config")
      .eq("id", body.orgId)
      .single();
    const cfg = orgInfo?.agenda_config
      ? getAgendaConfig(orgInfo.agenda_config)
      : AGENDA_CONFIG_DEFAULT;
    const { abre, fecha } = janelaFuncionamento(cfg);
    const diasDesc = descreverDiasNatural(cfg.dias_semana);
    const primeiroNome = lead.nome?.split(" ")[0] ?? null;
    const nome = primeiroNome ? `, ${primeiroNome}` : "";
    const texto = `Perfeito${nome}! A loja abre ${diasDesc}, das ${abre} às ${fecha}. Me diz o dia e o horário que ficam melhores pra você que eu já deixo anotado pra equipe.`;
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
      pedido: await pedidoAtual(),
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
    pedido: await pedidoAtual(),
  });
}
