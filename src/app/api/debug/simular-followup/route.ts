/**
 * Simula a GERACAO de um follow-up (IA) SEM enviar pelo WhatsApp e SEM persistir.
 * Usa exatamente o mesmo extrasContexto do followup real (montarExtrasFollowup),
 * entao o texto gerado aqui e o que o lead receberia de verdade.
 *
 *   POST /api/debug/simular-followup
 *   Authorization: Bearer <CRON_SECRET>
 *   Body: { "leadId": "uuid", "nivel"?: number }
 *     - nivel opcional; default = proximo nivel do lead (numero_followup + 1)
 *
 * Retorna { nivel, instrucao_ia, gerado }. Nada e enviado nem gravado.
 */
import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { gerarRespostaCaio } from "@/lib/caio/gerar-resposta";
import { montarExtrasFollowup, PROMPT_FOLLOWUP } from "@/lib/caio/followup";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "CRON_SECRET nao configurado" },
      { status: 500 },
    );
  }
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { leadId?: string; nivel?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON invalido" }, { status: 400 });
  }
  if (!body.leadId) {
    return NextResponse.json({ error: "leadId obrigatorio" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: lead } = await admin
    .from("leads")
    .select("id, organization_id, numero_followup")
    .eq("id", body.leadId)
    .single();
  if (!lead) {
    return NextResponse.json({ error: "lead nao encontrado" }, { status: 404 });
  }

  const { data: org } = await admin
    .from("organizations")
    .select("followup_config")
    .eq("id", lead.organization_id)
    .single();
  const regras = (
    (org?.followup_config as {
      regras?: Array<{
        nivel: number;
        ativo?: boolean;
        instrucao_ia?: string | null;
      }>;
    } | null)?.regras ?? []
  ).filter((r) => r.ativo !== false);

  const nivel = body.nivel ?? (lead.numero_followup ?? 0) + 1;
  const regra = regras.find((r) => r.nivel === nivel);
  if (!regra) {
    return NextResponse.json(
      { error: `sem regra de followup ativa pro nivel ${nivel}` },
      { status: 400 },
    );
  }

  const extras = montarExtrasFollowup(nivel, regras.length, regra.instrucao_ia);
  const result = await gerarRespostaCaio({
    leadId: lead.id,
    promptBaseOverride: PROMPT_FOLLOWUP,
    extrasContexto: extras,
  });
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  return NextResponse.json({
    nivel,
    instrucao_ia: regra.instrucao_ia ?? null,
    gerado: result.resposta,
  });
}
