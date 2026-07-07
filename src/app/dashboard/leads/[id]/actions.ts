"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  addLabel,
  enviarMensagem,
  toggleConversationStatus,
} from "@/lib/caio/chatwoot-api";
import { transcreverAudio } from "@/lib/caio/openai";
import { gerarRespostaCaio } from "@/lib/caio/gerar-resposta";
import { gerarResumoLead } from "@/lib/caio/resumo-ia";
import { logarEvento } from "@/lib/caio/eventos";
import { STATUS_CONFIG, type StatusLead } from "@/lib/status-config";

const AGENTE_OFF = "agente-off";

// Status que sinalizam que o lead "saiu" do funil — ao chegar nesses
// status, desligamos a IA e resolvemos a conversa no Chatwoot.
const STATUS_TERMINAIS: StatusLead[] = ["fechou", "perdido"];

/**
 * Envia uma mensagem pelo painel respondendo um lead.
 *
 * Aceita `desligar_caio` como flag opcional no FormData. Se for "true",
 * aplica a etiqueta `agente-off` (a IA para de responder esse lead).
 */
export async function responderLead(formData: FormData): Promise<
  { ok: true } | { error: string }
> {
  const leadId = formData.get("leadId");
  const conteudo = formData.get("conteudo");
  const desligarCaio = formData.get("desligar_caio") === "true";

  if (typeof leadId !== "string" || !leadId) {
    return { error: "leadId ausente" };
  }
  if (typeof conteudo !== "string" || !conteudo.trim()) {
    return { error: "Escreve alguma coisa antes de enviar" };
  }

  const supabase = await createClient();
  const { data: lead, error } = await supabase
    .from("leads")
    .select("id, organization_id, chatwoot_conversation_id")
    .eq("id", leadId)
    .single();

  if (error || !lead) {
    return { error: "Lead não encontrado (ou sem acesso)" };
  }
  if (!lead.chatwoot_conversation_id) {
    return {
      error:
        "Esse contato ainda não tem conversa vinculada — não dá pra responder",
    };
  }

  const sent = await enviarMensagem({
    conversationId: lead.chatwoot_conversation_id,
    content: conteudo.trim(),
  });
  if ("error" in sent) {
    return { error: `Falha ao enviar a mensagem no WhatsApp: ${sent.error}` };
  }

  const admin = createAdminClient();

  if (desligarCaio) {
    // leads.caio_ativo é a fonte da verdade (Chatwoot desativado / migrado p/
    // Evolution). Grava direto no banco, SEM depender do retorno do Chatwoot.
    await admin
      .from("leads")
      .update({ caio_ativo: false })
      .eq("id", leadId);
    // Espelha a etiqueta no Chatwoot best-effort (no-op pós-migração).
    await addLabel({
      conversationId: lead.chatwoot_conversation_id,
      label: AGENTE_OFF,
    });
  }

  if (sent.id === 0) {
    // Caminho Evolution: enviarMensagem JÁ persistiu a linha de saída (retorna
    // id 0 sintético). Inserir de novo duplicava o balão na 1ª resposta e
    // violava o unique(chatwoot_message_id=0) nas seguintes — só etiqueta o
    // remetente na linha recém-criada.
    const { data: ultima } = await admin
      .from("mensagens")
      .select("id")
      .eq("lead_id", lead.id)
      .eq("direcao", "saida")
      .eq("conteudo", sent.content)
      .is("remetente_nome", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (ultima) {
      await admin
        .from("mensagens")
        .update({ remetente_nome: "Você (painel)" })
        .eq("id", ultima.id);
    }
  } else {
    await admin.from("mensagens").insert({
      organization_id: lead.organization_id,
      lead_id: lead.id,
      chatwoot_message_id: sent.id,
      chatwoot_conversation_id: lead.chatwoot_conversation_id,
      conteudo: sent.content,
      tipo: "texto",
      direcao: "saida",
      remetente_nome: "Você (painel)",
      privada: false,
    });
  }

  // Resposta manual enviada — limpa o flag de "aguardando humano".
  await admin
    .from("leads")
    .update({
      precisa_resposta_humana: false,
      precisa_resposta_em: null,
    })
    .eq("id", lead.id);

  // Loga evento
  const {
    data: { user: userMsg },
  } = await supabase.auth.getUser();
  await logarEvento({
    leadId,
    organizationId: lead.organization_id,
    tipo: "msg_painel",
    descricao: `Resposta manual enviada${desligarCaio ? " e IA desligada" : ""}`,
    autorId: userMsg?.id ?? null,
    autorNome: userMsg?.email ?? null,
    meta: { conteudo: conteudo.trim().slice(0, 200) },
  });

  revalidatePath(`/dashboard/contatos/${leadId}`);
  return { ok: true };
}

/**
 * Liga/desliga a IA pra um lead específico. Fonte da verdade =
 * leads.caio_ativo no Supabase (Chatwoot desativado / migrado p/ Evolution):
 * lê o estado atual, inverte e grava no banco.
 */
export async function toggleCaio(formData: FormData): Promise<
  { ok: true; ativo: boolean } | { error: string }
> {
  const leadId = formData.get("leadId");
  if (typeof leadId !== "string" || !leadId) {
    return { error: "leadId ausente" };
  }

  const supabase = await createClient();
  const admin = createAdminClient();
  const { data: lead, error } = await supabase
    .from("leads")
    .select("caio_ativo, organization_id")
    .eq("id", leadId)
    .single();

  if (error || !lead) return { error: "Lead não encontrado" };

  const novoEstado = !(lead.caio_ativo ?? true); // true = IA respondendo

  // Espelha no banco (fonte da verdade). Se RELIGOU (novoEstado=true), limpa
  // o flag de "aguardando humano" — a IA voltou e vai cuidar.
  const updates: Record<string, unknown> = { caio_ativo: novoEstado };
  if (novoEstado) {
    updates.precisa_resposta_humana = false;
    updates.precisa_resposta_em = null;
  }
  const { error: updErr } = await admin
    .from("leads")
    .update(updates)
    .eq("id", leadId);
  if (updErr) return { error: `Falha ao atualizar a IA: ${updErr.message}` };

  // Loga evento
  const {
    data: { user: userToggle },
  } = await supabase.auth.getUser();
  if (lead.organization_id) {
    await logarEvento({
      leadId,
      organizationId: lead.organization_id,
      tipo: "caio_toggle",
      descricao: novoEstado ? "IA reativada" : "IA desligada (humano assumiu)",
      autorId: userToggle?.id ?? null,
      autorNome: userToggle?.email ?? null,
    });
  }

  revalidatePath(`/dashboard/contatos/${leadId}`);
  revalidatePath("/dashboard/leads");
  revalidatePath("/dashboard/prospeccao");
  return { ok: true, ativo: novoEstado };
}

/**
 * Troca MANUALMENTE qual número/persona do pool atende este lead (override).
 * Carimba `lead.evolution_instance` no número escolhido e marca `instancia_anterior`
 * — assim a PRÓXIMA resposta da nova persona reconhece a troca ("vamos continuar por
 * aqui, lá com o outro atendente você disse..."). A IA on/off continua sendo o ToggleCaio.
 */
export async function trocarAtendente(formData: FormData): Promise<
  { ok: true } | { error: string }
> {
  const leadId = formData.get("leadId");
  const instance = formData.get("instance");
  if (typeof leadId !== "string" || !leadId) return { error: "leadId ausente" };
  if (typeof instance !== "string" || !instance) return { error: "instância ausente" };

  const supabase = await createClient();
  const { data: lead, error } = await supabase
    .from("leads")
    .select("id, organization_id, evolution_instance")
    .eq("id", leadId)
    .single();
  if (error || !lead) return { error: "Lead não encontrado" };

  const admin = createAdminClient();

  // Valor especial "auto": solta a fixação — o lead volta a seguir o número
  // pelo qual o cliente escrever (comportamento padrão do pool).
  if (instance === "auto") {
    const { error: upErr } = await admin
      .from("leads")
      .update({ instancia_fixada: false })
      .eq("id", leadId);
    if (upErr) return { error: upErr.message };
    revalidatePath(`/dashboard/contatos/${leadId}`);
    return { ok: true };
  }

  // Valida que a instância pertence ao pool DESTA org (não deixa apontar p/
  // outra org) e que está saudável — rotear pra número travado/inativo
  // condenaria toda resposta a ~12s de tentativa + failover.
  const { data: num } = await admin
    .from("org_numeros")
    .select("instance_name, persona_nome, ativo, envio_falhando")
    .eq("organization_id", lead.organization_id)
    .eq("instance_name", instance)
    .maybeSingle();
  if (!num) return { error: "Número não está no pool da organização" };
  if (!num.ativo) return { error: "Esse número está desativado no pool" };
  if (num.envio_falhando)
    return { error: "Esse número está com envio falhando — escolha outro" };

  const antiga = (lead as { evolution_instance?: string | null }).evolution_instance ?? null;
  // Fixa SEMPRE que a escolha é manual — sem isso o próximo inbound do
  // cliente (que chega pelo número antigo) revertia a troca sozinho.
  const updates: Record<string, unknown> = {
    evolution_instance: instance,
    instancia_fixada: true,
  };
  if (antiga && antiga !== instance) updates.instancia_anterior = antiga; // próxima resposta reconhece a troca
  const { error: upErr } = await admin.from("leads").update(updates).eq("id", leadId);
  if (upErr) return { error: upErr.message };

  const {
    data: { user },
  } = await supabase.auth.getUser();
  await logarEvento({
    leadId,
    organizationId: lead.organization_id,
    tipo: "troca_atendente",
    descricao: `Atendente trocado p/ ${(num as { persona_nome?: string | null }).persona_nome ?? instance}`,
    autorId: user?.id ?? null,
    autorNome: user?.email ?? null,
  });

  revalidatePath(`/dashboard/contatos/${leadId}`);
  return { ok: true };
}

/**
 * Muda o status do lead manualmente pelo painel.
 *
 * Se o novo status for terminal (`fechou` ou `perdido`):
 *   - Aplica etiqueta `agente-off` (a IA para)
 *   - Resolve a conversa no Chatwoot
 *   - Atualiza `caio_ativo = false` no Supabase
 *
 * Se sair de um status terminal pra um ativo (ex: voltar pra `em_conversa`):
 *   - Reabre a conversa no Chatwoot
 *   (a etiqueta agente-off NÃO é removida automaticamente — usa o toggle pra isso)
 */
export async function mudarStatusLead(formData: FormData): Promise<
  { ok: true } | { error: string }
> {
  const leadId = formData.get("leadId");
  const novoStatus = formData.get("status");
  const razao = formData.get("razao");

  if (typeof leadId !== "string" || !leadId) {
    return { error: "leadId ausente" };
  }
  if (typeof novoStatus !== "string" || !novoStatus) {
    return { error: "status ausente" };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: lead, error } = await supabase
    .from("leads")
    .select("id, status, organization_id, chatwoot_conversation_id")
    .eq("id", leadId)
    .single();

  if (error || !lead) return { error: "Lead não encontrado" };

  const statusAntigo = lead.status as StatusLead;
  const statusNovo = novoStatus as StatusLead;
  const ehTerminal = STATUS_TERMINAIS.includes(statusNovo);
  const eraTerminal = STATUS_TERMINAIS.includes(statusAntigo);

  // Atualiza status no Supabase
  const admin = createAdminClient();
  const update: Record<string, unknown> = { status: statusNovo };
  if (typeof razao === "string" && razao.trim()) {
    update.razao = razao.trim();
  }
  if (ehTerminal) update.caio_ativo = false;

  // Regras de follow-up automaticas por mudanca manual de status:
  // - novo_lead / em_conversa: desliga + zera regras
  // - aguardando_primeiro_contato: reseta contadores de prospeccao pra que o
  //   proximo disparo comece da regra 1
  // - followup: liga, mantem nivel atual (continua de onde tava); se nunca rodou,
  //   agenda 1a regra
  // - reuniao_agendada / contatar_futuramente / fechou / perdido: desliga + zera
  if (statusNovo === "em_conversa" || statusNovo === "novo_lead") {
    update.followup_ativo = false;
    update.numero_followup = 0;
    update.numero_reativacao = 0;
    update.proximo_followup_em = null;
  } else if (statusNovo === "aguardando_primeiro_contato") {
    update.numero_prospeccao = 0;
    update.numero_followup = 0;
    update.numero_reativacao = 0;
    update.proximo_followup_em = null;
    update.caio_ativo = true;
    update.followup_ativo = true;
  } else if (statusNovo === "followup") {
    update.followup_ativo = true;
    // Se nunca rodou follow-up, agendar 1a regra agora
    const { data: leadAtual } = await admin
      .from("leads")
      .select("numero_followup, organization_id")
      .eq("id", leadId)
      .single();
    if (
      leadAtual &&
      (!leadAtual.numero_followup || leadAtual.numero_followup === 0)
    ) {
      const { data: org } = await admin
        .from("organizations")
        .select("followup_config")
        .eq("id", leadAtual.organization_id)
        .single();
      const config = org?.followup_config as
        | {
            regras?: {
              nivel: number;
              esperar_dias: number;
              esperar_horas: number;
              esperar_minutos: number;
              ativo: boolean;
            }[];
          }
        | null
        | undefined;
      const r1 = config?.regras?.find((r) => r.ativo && r.nivel === 1);
      if (r1) {
        const proximoEm = new Date();
        proximoEm.setDate(proximoEm.getDate() + (r1.esperar_dias ?? 0));
        proximoEm.setHours(proximoEm.getHours() + (r1.esperar_horas ?? 0));
        proximoEm.setMinutes(
          proximoEm.getMinutes() + (r1.esperar_minutos ?? 0),
        );
        update.proximo_followup_em = proximoEm.toISOString();
      }
    }
  } else if (statusNovo === "em_prospeccao") {
    // Continua na cadencia de prospeccao — nao mexe em numero_prospeccao
    // pra nao perder progresso. Garante a IA ligada.
    update.caio_ativo = true;
    update.followup_ativo = true;
  } else {
    // reuniao_agendada, contatar_futuramente, fechou, perdido
    update.followup_ativo = false;
    update.numero_followup = 0;
    update.numero_reativacao = 0;
    update.proximo_followup_em = null;
  }

  const { error: updateErr } = await admin
    .from("leads")
    .update(update)
    .eq("id", leadId);

  if (updateErr) {
    return { error: `Erro ao atualizar: ${updateErr.message}` };
  }

  // Status terminal não pode deixar rastro operacional órfão:
  // - perdido: cancela pedidos abertos e retiradas futuras (sugerido/agendado)
  //   — senão a fila de Pedidos e "Retiradas de hoje" cobram ação de um lead
  //   que saiu do funil.
  // - fechou: finaliza pedidos abertos (fechou = pedido concluído); retirada
  //   confirmada continua valendo (o cliente ainda vai buscar).
  if (statusNovo === "perdido") {
    await admin
      .from("pedidos")
      .update({ status: "cancelado", finalizado_em: new Date().toISOString() })
      .eq("lead_id", leadId)
      .in("status", ["captando", "pronto_para_equipe", "em_atendimento"]);
    await admin
      .from("agendamentos")
      .update({ status: "cancelado" })
      .eq("lead_id", leadId)
      .in("status", ["sugerido", "agendado"])
      .gte("data_inicio", new Date().toISOString());
    revalidatePath("/dashboard/pedidos");
    revalidatePath("/dashboard/agenda");
    revalidatePath("/dashboard");
  } else if (statusNovo === "fechou") {
    await admin
      .from("pedidos")
      .update({ status: "finalizado", finalizado_em: new Date().toISOString() })
      .eq("lead_id", leadId)
      .in("status", ["captando", "pronto_para_equipe", "em_atendimento"]);
    revalidatePath("/dashboard/pedidos");
    revalidatePath("/dashboard");
  }

  // Sincroniza Chatwoot — só se tiver conversa vinculada
  if (lead.chatwoot_conversation_id) {
    if (ehTerminal) {
      await addLabel({
        conversationId: lead.chatwoot_conversation_id,
        label: AGENTE_OFF,
      });
      await toggleConversationStatus({
        conversationId: lead.chatwoot_conversation_id,
        status: "resolved",
      });
    } else if (eraTerminal) {
      // saiu de terminal → reabre a conversa
      await toggleConversationStatus({
        conversationId: lead.chatwoot_conversation_id,
        status: "open",
      });
    }
  }

  // Loga evento (best effort — nao bloqueia se falhar)
  if (statusNovo !== statusAntigo) {
    await logarEvento({
      leadId,
      organizationId: lead.organization_id,
      tipo: "status_mudou",
      descricao: `Status mudou de "${STATUS_CONFIG[statusAntigo]?.label ?? statusAntigo}" pra "${STATUS_CONFIG[statusNovo]?.label ?? statusNovo}"`,
      autorId: user?.id ?? null,
      autorNome: user?.email ?? null,
      meta: { de: statusAntigo, para: statusNovo },
    });
  }

  revalidatePath(`/dashboard/contatos/${leadId}`);
  revalidatePath("/dashboard/leads");
  return { ok: true };
}

/**
 * Deleta um lead permanentemente.
 * Cascade remove mensagens e agendamentos vinculados.
 * NÃO mexe no Chatwoot — se o lead mandar nova mensagem, vai ser recriado.
 */
export async function deletarLead(formData: FormData): Promise<
  { ok: true } | { error: string }
> {
  const leadId = formData.get("leadId");
  if (typeof leadId !== "string" || !leadId) {
    return { error: "leadId ausente" };
  }

  const supabase = await createClient();
  // .select() detecta delete de 0 linhas (RLS/perfil sem org) — senão o botão
  // reporta sucesso e o contato continua na lista.
  const { data: deletados, error } = await supabase
    .from("leads")
    .delete()
    .eq("id", leadId)
    .select("id");
  if (error) return { error: error.message };
  if (!deletados || deletados.length === 0) {
    return { error: "Contato não encontrado (ou sem permissão pra deletar)." };
  }

  // O cascade do banco leva mensagens, pedidos, agendamentos e eventos — as
  // telas que listavam esse contato precisam revalidar.
  revalidatePath("/dashboard/leads");
  revalidatePath("/dashboard/contatos");
  revalidatePath("/dashboard/pedidos");
  revalidatePath("/dashboard/agenda");
  revalidatePath("/dashboard");
  return { ok: true };
}

/**
 * Gera resumo IA da conversa do lead via OpenAI.
 * Pega as últimas 40 mensagens, manda pra OpenAI com o RESUMO_PROMPT,
 * salva o resultado em leads.resumo_ia + leads.resumo_gerado_em.
 */
export async function gerarResumoIA(formData: FormData): Promise<
  { ok: true; resumo: string } | { error: string }
> {
  const leadId = formData.get("leadId");
  if (typeof leadId !== "string" || !leadId) {
    return { error: "leadId ausente" };
  }

  const supabase = await createClient();
  // Checa acesso via RLS antes de chamar a funcao admin
  const { error: leadErr } = await supabase
    .from("leads")
    .select("id")
    .eq("id", leadId)
    .single();
  if (leadErr) return { error: "Lead não encontrado" };

  const result = await gerarResumoLead({ leadId, salvar: true });
  if ("error" in result) return { error: result.error };

  revalidatePath(`/dashboard/contatos/${leadId}`);
  return { ok: true, resumo: result.resumo };
}

/**
 * Gera uma sugestão de resposta da IA com base no histórico da conversa.
 * NÃO envia — só devolve o texto pra UI preencher o textarea.
 */
export async function gerarSugestaoResposta(formData: FormData): Promise<
  { ok: true; sugestao: string } | { error: string }
> {
  const leadId = formData.get("leadId");
  if (typeof leadId !== "string" || !leadId) {
    return { error: "leadId ausente" };
  }

  // Checa acesso via RLS antes da função admin (gerarRespostaCaio bypassa
  // RLS) — sem isso qualquer usuário autenticado leria conversa de outra org.
  const supabase = await createClient();
  const { error: leadErr } = await supabase
    .from("leads")
    .select("id")
    .eq("id", leadId)
    .single();
  if (leadErr) return { error: "Lead não encontrado" };

  const result = await gerarRespostaCaio({ leadId });
  if ("error" in result) return { error: result.error };
  return { ok: true, sugestao: result.resposta };
}

/**
 * Aprova uma sugestão shadow da IA: envia pelo Chatwoot, aplica
 * agente-off (o agente do n8n para de responder) e converte a mensagem
 * shadow em mensagem real (saida) atualizando o chatwoot_message_id.
 */
export async function aprovarShadow(formData: FormData): Promise<
  { ok: true } | { error: string }
> {
  const mensagemId = formData.get("mensagemId");
  if (typeof mensagemId !== "string" || !mensagemId) {
    return { error: "mensagemId ausente" };
  }

  const supabase = await createClient();
  const { data: msg, error } = await supabase
    .from("mensagens")
    .select(
      "id, lead_id, organization_id, conteudo, shadow, chatwoot_conversation_id",
    )
    .eq("id", mensagemId)
    .single();
  if (error || !msg) return { error: "Mensagem shadow não encontrada" };
  if (!msg.shadow) return { error: "Mensagem não é shadow" };
  if (!msg.conteudo?.trim()) return { error: "Shadow sem conteúdo" };
  if (!msg.chatwoot_conversation_id) {
    return { error: "Sem conversa do Chatwoot vinculada" };
  }

  // 1. Envia (Evolution por baixo; Chatwoot é legado)
  const sent = await enviarMensagem({
    conversationId: msg.chatwoot_conversation_id,
    content: msg.conteudo,
  });
  if ("error" in sent) {
    return { error: `Falha ao enviar a mensagem no WhatsApp: ${sent.error}` };
  }

  // 2. Aplica agente-off (o agente do n8n para de responder)
  const label = await addLabel({
    conversationId: msg.chatwoot_conversation_id,
    label: AGENTE_OFF,
  });
  if ("error" in label) {
    console.warn("[painel:aprovar-shadow]", "agente-off:", label.error);
  }

  // 3. Converte shadow em mensagem real
  const admin = createAdminClient();
  if (sent.id === 0) {
    // Caminho Evolution: o envio JÁ inseriu o balão real de saída. Gravar
    // chatwoot_message_id=0 na shadow violava o unique e o update falhava em
    // silêncio — a sugestão continuava na tela com o botão Aprovar, e o
    // segundo clique mandava a MESMA mensagem de novo pro cliente. Deleta a
    // shadow (o balão real já está na timeline) e etiqueta o remetente.
    await admin.from("mensagens").delete().eq("id", mensagemId);
    const { data: ultima } = await admin
      .from("mensagens")
      .select("id")
      .eq("lead_id", msg.lead_id)
      .eq("direcao", "saida")
      .eq("conteudo", msg.conteudo)
      .is("remetente_nome", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (ultima) {
      await admin
        .from("mensagens")
        .update({ remetente_nome: "Você (aprovou sugestão da IA)" })
        .eq("id", ultima.id);
    }
  } else {
    const { error: convErr } = await admin
      .from("mensagens")
      .update({
        shadow: false,
        chatwoot_message_id: sent.id,
        remetente_nome: "Você (aprovou sugestão da IA)",
      })
      .eq("id", mensagemId);
    if (convErr) {
      console.warn("[painel:aprovar-shadow] conversão falhou:", convErr.message);
    }
  }

  // 4. Atualiza caio_ativo no lead
  await admin
    .from("leads")
    .update({ caio_ativo: false })
    .eq("id", msg.lead_id);

  revalidatePath(`/dashboard/contatos/${msg.lead_id}`);
  revalidatePath("/dashboard/leads");
  return { ok: true };
}

/**
 * Descarta uma sugestão shadow da IA — deleta a mensagem do banco.
 */
export async function descartarShadow(formData: FormData): Promise<
  { ok: true } | { error: string }
> {
  const mensagemId = formData.get("mensagemId");
  if (typeof mensagemId !== "string" || !mensagemId) {
    return { error: "mensagemId ausente" };
  }

  const supabase = await createClient();
  const { data: msg } = await supabase
    .from("mensagens")
    .select("id, lead_id, shadow")
    .eq("id", mensagemId)
    .single();
  if (!msg) return { error: "Mensagem não encontrada" };
  if (!msg.shadow) return { error: "Mensagem não é shadow" };

  const admin = createAdminClient();
  await admin.from("mensagens").delete().eq("id", mensagemId);

  revalidatePath(`/dashboard/contatos/${msg.lead_id}`);
  return { ok: true };
}

/**
 * Força transcrição (ou re-transcrição) de uma mensagem de áudio.
 * Útil pra áudios antigos que não foram transcritos por falta de env
 * var na hora do webhook, ou pra regerar uma transcrição ruim.
 */
export async function retranscreverAudio(formData: FormData): Promise<
  { ok: true; texto: string } | { error: string }
> {
  const mensagemId = formData.get("mensagemId");
  if (typeof mensagemId !== "string" || !mensagemId) {
    return { error: "mensagemId ausente" };
  }

  const supabase = await createClient();
  const { data: msg, error } = await supabase
    .from("mensagens")
    .select("id, lead_id, tipo, attachment_url")
    .eq("id", mensagemId)
    .single();
  if (error || !msg) return { error: "Mensagem não encontrada" };
  if (msg.tipo !== "audio") return { error: "Mensagem não é áudio" };
  if (!msg.attachment_url) return { error: "Áudio sem URL pra baixar" };

  const result = await transcreverAudio({ audioUrl: msg.attachment_url });
  if ("error" in result) {
    return { error: `Whisper falhou: ${result.error}` };
  }

  const admin = createAdminClient();
  await admin
    .from("mensagens")
    .update({ conteudo: result.texto })
    .eq("id", mensagemId);

  revalidatePath(`/dashboard/contatos/${msg.lead_id}`);
  return { ok: true, texto: result.texto };
}

/**
 * Salva notas internas (observações livres do agente humano) no lead.
 */
export async function salvarNotas(formData: FormData): Promise<
  { ok: true } | { error: string }
> {
  const leadId = formData.get("leadId");
  const notas = formData.get("notas");

  if (typeof leadId !== "string" || !leadId) {
    return { error: "leadId ausente" };
  }
  if (typeof notas !== "string") {
    return { error: "notas inválidas" };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("leads")
    .update({ notas: notas.trim() || null })
    .eq("id", leadId);

  if (error) return { error: error.message };

  revalidatePath(`/dashboard/contatos/${leadId}`);
  return { ok: true };
}

/**
 * Finaliza/dispensa a notificação de handoff de um lead (limpa precisa_humano_*).
 * Usado pelo botão "Finalizar" no sino quando o humano já cuidou do lead — senão a
 * notificação fica presa pra sempre (nada limpava esses campos antes).
 */
export async function resolverHandoff(formData: FormData): Promise<
  { ok: true } | { error: string }
> {
  const leadId = formData.get("leadId");
  if (typeof leadId !== "string" || !leadId) {
    return { error: "leadId ausente" };
  }
  // Valida acesso pela RLS (o usuário precisa enxergar o lead da org dele).
  const supabase = await createClient();
  const { data: lead, error } = await supabase
    .from("leads")
    .select("id")
    .eq("id", leadId)
    .single();
  if (error || !lead) return { error: "Lead não encontrado" };

  const admin = createAdminClient();
  // precisa_humano=false é o que tira o lead do sino/pendências — sem isso a
  // notificação ficava presa pra sempre (o sino filtra por esse boolean).
  const { error: updErr } = await admin
    .from("leads")
    .update({
      precisa_humano: false,
      precisa_humano_motivo: null,
      precisa_humano_em: null,
      precisa_resposta_humana: false,
    })
    .eq("id", leadId);
  if (updErr) return { error: updErr.message };
  revalidatePath("/dashboard");
  revalidatePath(`/dashboard/contatos/${leadId}`);
  return { ok: true };
}

/**
 * Liga ou desliga follow-up automatico de um lead especifico.
 * Quando desliga, o worker ignora esse lead mesmo se proximo_followup_em vencer.
 * Quando liga, se nao houver proximo agendado e a org tiver regras, agenda a 1a.
 */
export async function toggleFollowupAtivo(formData: FormData): Promise<
  { ok: true } | { error: string }
> {
  const leadId = formData.get("leadId");
  const ativoStr = formData.get("ativo");
  if (typeof leadId !== "string" || !leadId) {
    return { error: "leadId ausente" };
  }
  const ativo = ativoStr === "true";

  // Checa acesso via RLS antes de escrever com o admin client (isolamento
  // multi-tenant) e pega o status pra barrar religada indevida.
  const supabase = await createClient();
  const { data: leadAcesso, error: leadErr } = await supabase
    .from("leads")
    .select("id, status")
    .eq("id", leadId)
    .single();
  if (leadErr || !leadAcesso) return { error: "Lead não encontrado" };

  // Religar follow-up em lead que já combinou retirada / fechou / saiu do
  // funil dispararia "quer fechar seu pedido?" pra quem já fechou — o worker
  // não filtra status, então o bloqueio é aqui.
  if (
    ativo &&
    ["reuniao_agendada", "fechou", "perdido"].includes(leadAcesso.status)
  ) {
    return {
      error:
        "Esse contato já combinou a retirada (ou saiu do funil) — o follow-up foi desligado automaticamente e religar mandaria mensagem indevida. Se o caso mudou, troque o status do contato primeiro.",
    };
  }

  const admin = createAdminClient();
  const update: Record<string, unknown> = { followup_ativo: ativo };

  if (!ativo) {
    update.proximo_followup_em = null;
  } else {
    // Liga: se nao tem proximo agendado, agenda baseado no numero_followup atual
    const { data: lead } = await admin
      .from("leads")
      .select("numero_followup, proximo_followup_em, organization_id")
      .eq("id", leadId)
      .single();
    if (lead && !lead.proximo_followup_em) {
      const { data: org } = await admin
        .from("organizations")
        .select("followup_config")
        .eq("id", lead.organization_id)
        .single();
      const config = org?.followup_config as
        | {
            regras?: {
              nivel: number;
              esperar_dias: number;
              esperar_horas: number;
              esperar_minutos: number;
              ativo: boolean;
            }[];
          }
        | null
        | undefined;
      const proximoNivel = (lead.numero_followup ?? 0) + 1;
      const regra = config?.regras?.find(
        (r) => r.ativo && r.nivel === proximoNivel,
      );
      if (regra) {
        const proximoEm = new Date();
        proximoEm.setDate(proximoEm.getDate() + (regra.esperar_dias ?? 0));
        proximoEm.setHours(proximoEm.getHours() + (regra.esperar_horas ?? 0));
        proximoEm.setMinutes(
          proximoEm.getMinutes() + (regra.esperar_minutos ?? 0),
        );
        update.proximo_followup_em = proximoEm.toISOString();
      }
    }
  }

  const { error } = await admin
    .from("leads")
    .update(update)
    .eq("id", leadId);

  if (error) return { error: error.message };

  // Loga evento
  const { data: leadOrg } = await admin
    .from("leads")
    .select("organization_id")
    .eq("id", leadId)
    .single();
  const {
    data: { user: userFollow },
  } = await supabase.auth.getUser();
  if (leadOrg?.organization_id) {
    await logarEvento({
      leadId,
      organizationId: leadOrg.organization_id,
      tipo: "followup_toggle",
      descricao: ativo ? "Follow-up ativado" : "Follow-up desativado",
      autorId: userFollow?.id ?? null,
      autorNome: userFollow?.email ?? null,
    });
  }

  revalidatePath(`/dashboard/contatos/${leadId}`);
  return { ok: true };
}
