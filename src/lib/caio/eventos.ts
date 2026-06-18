/**
 * Helper pra registrar eventos no log do lead.
 * Usa admin client porque a policy de INSERT exige is_admin() — actions
 * server-side e workers sempre rodam com service_role.
 */

import { createAdminClient } from "@/lib/supabase/admin";

export type TipoEvento =
  | "status_mudou"
  | "caio_toggle"
  | "followup_toggle"
  | "followup_enviado"
  | "lembrete_enviado"
  | "msg_painel"
  | "lead_criado"
  | "reativacao_enviada"
  | "prospeccao_enviada"
  | "handoff_humano";

export async function logarEvento(opts: {
  leadId: string;
  organizationId: string;
  tipo: TipoEvento;
  descricao: string;
  autorId?: string | null;
  autorNome?: string | null;
  meta?: Record<string, unknown> | null;
}) {
  const supabase = createAdminClient();
  const { error } = await supabase.from("lead_eventos").insert({
    lead_id: opts.leadId,
    organization_id: opts.organizationId,
    tipo: opts.tipo,
    descricao: opts.descricao,
    autor_id: opts.autorId ?? null,
    autor_nome: opts.autorNome ?? null,
    meta: opts.meta ?? null,
  });
  if (error) {
    console.warn("[eventos] falha ao logar:", error.message);
  }
}
