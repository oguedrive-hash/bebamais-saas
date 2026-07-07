/**
 * Reconciliação tardia de envio.
 *
 * O aceite síncrono espera 6s — mas a Meta pode rejeitar DEPOIS (o lock 463
 * derrubava envios com stub chegando 8-15s após o POST). Nesse cenário o
 * painel dizia "enviado", a IA era desligada ("Desligar IA ao enviar") e o
 * cliente ficava no vácuo sem ninguém saber.
 *
 * Aqui: ~45s após cada envio persistido, re-consulta o status na Evolution.
 * Se deu ERROR: marca a mensagem (badge "não entregue" na timeline), reacende
 * precisa_resposta_humana no lead (volta pro sino/pendências) e avisa o admin.
 *
 * setTimeout in-process de propósito — instância única (mesmo padrão da fila
 * de envio). Se o processo reiniciar no meio, perde-se um recheck: aceitável.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { statusMensagem } from "@/lib/caio/evolution-api";
import { notificarAdminFalha } from "@/lib/caio/notificar-admin";

const RECHECK_MS = 45_000;

export function agendarRecheckEnvio(opts: {
  instance: string;
  msgId: string;
  mensagemRowId: string | null;
  leadId: string;
  organizationId: string;
  conteudo: string;
}): void {
  setTimeout(async () => {
    try {
      const st = await statusMensagem(opts.instance, opts.msgId);
      if (st !== "ERROR") return; // OK/PENDING/null → nada a fazer
      console.warn(
        "[reconciliacao-envio] mensagem REJEITADA pós-aceite:",
        opts.msgId.slice(0, 8),
        "lead",
        opts.leadId,
      );
      const admin = createAdminClient();
      if (opts.mensagemRowId) {
        await admin
          .from("mensagens")
          .update({ falha_envio: true })
          .eq("id", opts.mensagemRowId);
      }
      // Reacende o alerta de resposta humana — o lead volta pro sino e pras
      // pendências da home (a resposta que "foi" não foi).
      const { data: lead } = await admin
        .from("leads")
        .update({
          precisa_resposta_humana: true,
          precisa_resposta_em: new Date().toISOString(),
        })
        .eq("id", opts.leadId)
        .select("nome, telefone")
        .maybeSingle();
      await notificarAdminFalha({
        organizationId: opts.organizationId,
        leadNome: lead?.nome ?? null,
        leadTelefone: lead?.telefone ?? "?",
        conteudoLead: opts.conteudo,
        erro: "Mensagem REJEITADA pelo WhatsApp depois do envio (reconciliação 45s) — o cliente NÃO recebeu. Responder manualmente.",
      });
    } catch (e) {
      console.warn(
        "[reconciliacao-envio] recheck falhou:",
        e instanceof Error ? e.message : String(e),
      );
    }
  }, RECHECK_MS);
}
