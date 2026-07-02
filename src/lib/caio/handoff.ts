/**
 * Handoff: tira a IA da conversa e chama humano. Dispara quando:
 *  - lead pede pra reagendar/cancelar retirada
 *  - lead esta irritado/xingando
 *  - lead pede explicitamente falar com pessoa
 *
 * Acoes:
 *  - leads.caio_ativo=false, followup_ativo=false (a IA para)
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
  const nome = primeiroNome ? `, ${primeiroNome}` : "";
  if (motivo === "muda_reuniao") {
    return `Deixa comigo${nome}! Vou chamar nosso time pra ajustar isso pra você — em alguns minutos alguém te chama por aqui.`;
  }
  if (motivo === "irritado") {
    return `Poxa${nome}, sinto muito pelo transtorno! Já chamei nosso time pra resolver isso com você — em alguns minutos alguém fala com você por aqui.`;
  }
  return `Claro${nome}! Já chamei nosso time pra te atender — em alguns minutos alguém fala com você por aqui.`;
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
    descricao: `Handoff disparado (${opts.motivo}). IA off, time avisado.`,
    autorNome: "Atendente IA (automatico)",
    meta: { motivo: opts.motivo, ultima_msg: opts.ultimaMsg.slice(0, 200) },
  });

  // Se o lead tem pedido em captação com itens, promove pra fila da equipe —
  // o humano vai assumir a conversa e precisa ver o pedido. Carimba
  // equipe_notificada_em pra NÃO gerar segunda notificação (o próprio handoff
  // já avisa o admin) e confirmado_em pra entrar na ordem FIFO da fila.
  async function promoverPedidoCaptando(): Promise<string | null> {
    const agoraISO = new Date().toISOString();
    const { data } = await supabase
      .from("pedidos")
      .update({
        status: "pronto_para_equipe",
        confirmado_em: agoraISO,
        equipe_notificada_em: agoraISO,
      })
      .eq("lead_id", opts.leadId)
      .eq("status", "captando")
      .neq("itens", "[]")
      .select("id")
      .maybeSingle();
    return data?.id ?? null;
  }

  const pedidoPromovidoId = await promoverPedidoCaptando();
  if (pedidoPromovidoId) {
    await logarEvento({
      leadId: opts.leadId,
      organizationId: opts.organizationId,
      tipo: "pedido_pronto",
      descricao: "Pedido em captação promovido pra equipe (handoff humano).",
      autorNome: "Atendente IA (automatico)",
      meta: { pedido_id: pedidoPromovidoId, via: "handoff" },
    });
  } else {
    // Corrida: a extração do MESMO ciclo pode ainda estar em voo (fire-and-
    // forget com LLM de 2-8s) e criar o pedido DEPOIS deste promote. Como o
    // handoff desliga a IA (extrator não roda mais pro lead), o pedido
    // nasceria e morreria em "captando". Retry único e atrasado cobre isso.
    setTimeout(() => {
      void promoverPedidoCaptando()
        .then((id) => {
          if (id) {
            void logarEvento({
              leadId: opts.leadId,
              organizationId: opts.organizationId,
              tipo: "pedido_pronto",
              descricao:
                "Pedido em captação promovido pra equipe (handoff humano, retry).",
              autorNome: "Atendente IA (automatico)",
              meta: { pedido_id: id, via: "handoff_retry" },
            });
          }
        })
        .catch((e) =>
          console.warn(
            "[handoff] retry promote falhou:",
            e instanceof Error ? e.message : String(e),
          ),
        );
    }, 15_000);
  }

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
