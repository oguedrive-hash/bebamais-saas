/**
 * Extrator de pedido — mantém o pedido ESTRUTURADO do lead sincronizado
 * com a conversa (contexto Beba Mais: o Caio tira pedidos; o atendente
 * humano finaliza preço/pagamento no painel).
 *
 * Roda fire-and-forget 1x por ciclo de resposta do Caio (pós-debounce,
 * plugado no responderLeadAuto). Lê a janela recente da conversa, extrai
 * itens/modalidade/endereço/nome via gpt-4o-mini (JSON, temp 0 — padrão
 * dos classificadores) e faz upsert na tabela `pedidos`.
 *
 * Máquina de estados (quem transiciona):
 *   captando            ← extrator cria ao detectar o 1º item
 *   pronto_para_equipe  ← extrator, quando completo && confirmado (update
 *                          guardado: transiciona e notifica admin UMA vez)
 *   em_atendimento      ← atendente clica "Assumir" (extrator PARA de rodar)
 *   finalizado/cancelado← atendente no painel
 *
 * Guardas:
 *  - editado_pelo_painel=true → extrator não sobrescreve (humano é dono)
 *  - corte temporal: só msgs posteriores ao último pedido fechado do lead
 *    (cliente recorrente não re-extrai pedido antigo)
 *  - validação estrutural pós-parse; nunca cria pedido sem itens
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { chatCompletion } from "./openai";
import { logarEvento } from "./eventos";
import { notificarAdminPedidoPronto } from "./notificar-admin";

export type ItemPedido = {
  produto: string;
  quantidade: number;
  unidade?: string | null;
};

export type ExtracaoPedido = {
  itens: ItemPedido[];
  modalidade: "retirada" | "entrega" | null;
  endereco: string | null;
  nome_cliente: string | null;
  completo: boolean;
  confirmado: boolean;
};

const SYSTEM_PROMPT = `Você é um extrator de dados. Leia a conversa entre o atendente da Beba Mais (distribuidora de bebidas) e o cliente e extraia o PEDIDO ATUAL como JSON.

Retorne APENAS JSON, sem markdown:
{"itens":[{"produto":"...","quantidade":N,"unidade":"caixa|fardo|pack|unidade|litro ou null"}],"modalidade":"retirada"|"entrega"|null,"endereco":"..."|null,"nome_cliente":"..."|null,"completo":true|false,"confirmado":true|false}

REGRAS:
- "itens": só o que o cliente PEDIU (não o que só perguntou preço). Nome do produto normalizado como dito (ex: "Skol lata 350ml"). Se ainda não pediu nada: [].
- Se o cliente MUDOU o pedido no meio da conversa, extraia a versão MAIS RECENTE.
- "modalidade": "retirada" se vai buscar na loja, "entrega" se pediu entrega, null se indefinido.
- "endereco": só se entrega e o cliente informou (bairro conta); senão null.
- "nome_cliente": nome que o cliente DISSE na conversa; null se não disse.
- "completo": true se tem itens E modalidade definida E (endereco quando entrega) E nome_cliente.
- "confirmado": true SOMENTE se o atendente RECAPITULOU o pedido (listou os itens de volta) E o cliente respondeu AFIRMANDO depois do recap ("isso", "isso mesmo", "fechou", "pode ser", "confirmo"). Se o cliente alterou algo depois do último recap → false.
- NUNCA invente item, quantidade ou endereço que não estejam na conversa.`;

type PedidoRow = {
  id: string;
  status: string;
  itens: ItemPedido[];
  modalidade: string | null;
  endereco: string | null;
  nome_cliente: string | null;
  editado_pelo_painel: boolean;
  updated_at: string;
};

function validarExtracao(raw: unknown): ExtracaoPedido | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const itensRaw = Array.isArray(o.itens) ? o.itens : [];
  const itens: ItemPedido[] = [];
  for (const it of itensRaw.slice(0, 30)) {
    if (!it || typeof it !== "object") continue;
    const i = it as Record<string, unknown>;
    const produto = typeof i.produto === "string" ? i.produto.trim() : "";
    const quantidade = Number(i.quantidade);
    if (!produto || !Number.isFinite(quantidade) || quantidade <= 0) continue;
    itens.push({
      produto: produto.slice(0, 120),
      quantidade,
      unidade:
        typeof i.unidade === "string" && i.unidade.trim()
          ? i.unidade.trim().slice(0, 30)
          : null,
    });
  }
  const modalidade =
    o.modalidade === "retirada" || o.modalidade === "entrega"
      ? o.modalidade
      : null;
  return {
    itens,
    modalidade,
    endereco:
      typeof o.endereco === "string" && o.endereco.trim()
        ? o.endereco.trim().slice(0, 300)
        : null,
    nome_cliente:
      typeof o.nome_cliente === "string" && o.nome_cliente.trim()
        ? o.nome_cliente.trim().slice(0, 120)
        : null,
    completo: o.completo === true,
    confirmado: o.confirmado === true,
  };
}

function itensLabel(itens: ItemPedido[]): string {
  return itens
    .map(
      (i) =>
        `${i.quantidade}${i.unidade ? ` ${i.unidade}` : "x"} ${i.produto}`,
    )
    .join(" · ");
}

/** Extrai o pedido da conversa e sincroniza a tabela `pedidos`. Fire-and-forget. */
export async function extrairEAtualizarPedido(opts: {
  organizationId: string;
  leadId: string;
}): Promise<void> {
  const admin = createAdminClient();

  // Pedido aberto atual (no máx 1, por índice único parcial)
  const { data: aberto } = await admin
    .from("pedidos")
    .select(
      "id, status, itens, modalidade, endereco, nome_cliente, editado_pelo_painel, updated_at",
    )
    .eq("lead_id", opts.leadId)
    .in("status", ["captando", "pronto_para_equipe", "em_atendimento"])
    .maybeSingle<PedidoRow>();

  // Humano assumiu → ele é o dono; não gasta LLM
  if (aberto?.status === "em_atendimento") return;
  // Humano editou → o extrator NÃO sobrescreve os campos, mas continua
  // rodando pra detectar a CONFIRMAÇÃO do cliente (senão pedido editado em
  // captando nunca promoveria pra fila da equipe).
  const bloqueadoEdicao = aberto?.editado_pelo_painel === true;

  // Corte temporal: cliente recorrente — ignora a conversa do pedido anterior
  const { data: ultimoFechado } = await admin
    .from("pedidos")
    .select("updated_at")
    .eq("lead_id", opts.leadId)
    .in("status", ["finalizado", "cancelado"])
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let q = admin
    .from("mensagens")
    .select("conteudo, direcao, tipo")
    .eq("lead_id", opts.leadId)
    .eq("shadow", false)
    .order("created_at", { ascending: false })
    .limit(20);
  if (ultimoFechado?.updated_at) {
    q = q.gt("created_at", ultimoFechado.updated_at);
  }
  const { data: msgs } = await q;
  if (!msgs || msgs.length === 0) return;
  msgs.reverse();

  const transcript = msgs
    .map((m) => {
      const quem = m.direcao === "entrada" ? "Cliente" : "Atendente";
      const conteudo = m.conteudo?.trim() || `(${m.tipo} sem transcrição)`;
      return `${quem}: ${conteudo}`;
    })
    .join("\n");

  const result = await chatCompletion({
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: `Conversa:\n${transcript}` },
    ],
    temperature: 0,
    // 30 itens no limite da validação geram JSON grande — 400 truncava e o
    // parse falhava TODO ciclo em pedido grande (distribuidora tem carrinhão).
    max_tokens: 1200,
  });
  if ("error" in result) {
    console.warn("[pedido:extrator] LLM erro:", result.error);
    return;
  }

  let extracao: ExtracaoPedido | null = null;
  try {
    const limpo = result.content.trim().replace(/^```json\n?|```$/g, "");
    extracao = validarExtracao(JSON.parse(limpo));
  } catch (err) {
    console.warn("[pedido:extrator] parse falhou:", err, result.content.slice(0, 200));
    return;
  }
  if (!extracao) return;

  // Nada pedido ainda e sem pedido aberto → não cria linha vazia
  if (extracao.itens.length === 0 && !aberto) return;

  let pedidoId = aberto?.id ?? null;

  if (!pedidoId && extracao.itens.length > 0) {
    // Cria em captando (corrida com outro ciclo cai no 23505 → re-seleciona)
    const { data: novo, error: insErr } = await admin
      .from("pedidos")
      .insert({
        organization_id: opts.organizationId,
        lead_id: opts.leadId,
        itens: extracao.itens,
        modalidade: extracao.modalidade,
        endereco: extracao.endereco,
        nome_cliente: extracao.nome_cliente,
        status: "captando",
      })
      .select("id")
      .single();
    if (insErr) {
      if (insErr.code === "23505") {
        const { data: existente } = await admin
          .from("pedidos")
          .select("id")
          .eq("lead_id", opts.leadId)
          .in("status", ["captando", "pronto_para_equipe", "em_atendimento"])
          .maybeSingle();
        pedidoId = existente?.id ?? null;
      } else {
        console.warn("[pedido:extrator] insert falhou:", insErr.message);
        return;
      }
    } else {
      pedidoId = novo?.id ?? null;
      if (pedidoId) {
        await logarEvento({
          leadId: opts.leadId,
          organizationId: opts.organizationId,
          tipo: "pedido_extraido",
          descricao: `Pedido detectado na conversa: ${itensLabel(extracao.itens)}`,
          autorNome: "Caio (extrator)",
          meta: { pedido_id: pedidoId, itens: extracao.itens },
        });
      }
    }
  } else if (pedidoId && aberto && !bloqueadoEdicao && extracao.itens.length > 0) {
    // Atualiza o pedido aberto com a extração mais recente.
    // MERGE nos campos escalares: a janela de 20 msgs pode ter deixado o
    // endereço/nome pra trás — extração null NÃO apaga valor já gravado.
    // CAS via updated_at: se outro ciclo escreveu no meio, este write stale
    // casa 0 linhas e desiste (o próximo ciclo re-extrai).
    const mudou =
      JSON.stringify(aberto.itens ?? []) !== JSON.stringify(extracao.itens);
    await admin
      .from("pedidos")
      .update({
        itens: extracao.itens,
        modalidade: extracao.modalidade ?? aberto.modalidade,
        endereco: extracao.endereco ?? aberto.endereco,
        nome_cliente: extracao.nome_cliente ?? aberto.nome_cliente,
      })
      .eq("id", pedidoId)
      .eq("editado_pelo_painel", false)
      .eq("updated_at", aberto.updated_at)
      .in("status", ["captando", "pronto_para_equipe"]);
    if (mudou && aberto.status === "pronto_para_equipe") {
      await logarEvento({
        leadId: opts.leadId,
        organizationId: opts.organizationId,
        tipo: "pedido_alterado",
        descricao: `Cliente alterou o pedido após confirmar: ${itensLabel(extracao.itens)}`,
        autorNome: "Caio (extrator)",
        meta: { pedido_id: pedidoId, itens: extracao.itens },
      });
    }
  }

  if (!pedidoId) return;

  // Propaga nome dito na conversa pro lead (se lead ainda sem nome)
  if (extracao.nome_cliente) {
    await admin
      .from("leads")
      .update({ nome: extracao.nome_cliente })
      .eq("id", opts.leadId)
      .or("nome.is.null,nome.eq.");
  }

  // Reconciliação: pedido de retirada sem agendamento vinculado + agendamento
  // futuro existente do lead → linka (cobre agendamento criado antes do pedido)
  if (extracao.modalidade === "retirada") {
    const { data: ag } = await admin
      .from("agendamentos")
      .select("id")
      .eq("lead_id", opts.leadId)
      .eq("status", "agendado")
      .gte("data_inicio", new Date().toISOString())
      .order("data_inicio", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (ag) {
      await admin
        .from("pedidos")
        .update({ agendamento_id: ag.id })
        .eq("id", pedidoId)
        .is("agendamento_id", null);
    }
  }

  // Transição captando → pronto_para_equipe (guardada: 1 transição, 1 notificação).
  // Pedido EDITADO pelo painel: o dado oficial são os itens do BANCO (edição do
  // humano), então a promoção usa eles e ignora o "completo" da extração.
  const itensPromocao = bloqueadoEdicao ? (aberto?.itens ?? []) : extracao.itens;
  const modalidadePromocao = bloqueadoEdicao
    ? ((aberto?.modalidade as "retirada" | "entrega" | null) ?? null)
    : extracao.modalidade;
  const enderecoPromocao = bloqueadoEdicao ? (aberto?.endereco ?? null) : extracao.endereco;
  if (
    extracao.confirmado &&
    itensPromocao.length > 0 &&
    (bloqueadoEdicao || extracao.completo)
  ) {
    const agora = new Date().toISOString();
    const { data: promovido } = await admin
      .from("pedidos")
      .update({
        status: "pronto_para_equipe",
        confirmado_em: agora,
        equipe_notificada_em: agora,
      })
      .eq("id", pedidoId)
      .eq("status", "captando")
      .is("equipe_notificada_em", null)
      .select("id")
      .maybeSingle();

    if (promovido) {
      const { data: lead } = await admin
        .from("leads")
        .select("nome, telefone")
        .eq("id", opts.leadId)
        .single();
      await logarEvento({
        leadId: opts.leadId,
        organizationId: opts.organizationId,
        tipo: "pedido_pronto",
        descricao: `Pedido confirmado pelo cliente — pronto pra equipe finalizar: ${itensLabel(itensPromocao)}`,
        autorNome: "Caio (extrator)",
        meta: { pedido_id: pedidoId, itens: itensPromocao, modalidade: modalidadePromocao },
      });
      await notificarAdminPedidoPronto({
        organizationId: opts.organizationId,
        leadId: opts.leadId,
        leadNome: lead?.nome ?? extracao.nome_cliente,
        leadTelefone: lead?.telefone ?? "",
        itens: itensPromocao,
        modalidade: modalidadePromocao,
        endereco: enderecoPromocao,
      });
    }
  }
}
