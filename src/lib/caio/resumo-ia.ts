/**
 * Gera resumo IA da conversa de um lead. Usado:
 *  - Server action gerarResumoIA() (manual no painel)
 *  - notificarAdminAgendamento (automatico quando Caio fecha retirada)
 *
 * Pega as ultimas N mensagens e roda pelo RESUMO_PROMPT.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { chatCompletion } from "@/lib/caio/openai";
import { RESUMO_PROMPT } from "@/lib/caio/system-prompt";

export async function gerarResumoLead(opts: {
  leadId: string;
  limite?: number;
  salvar?: boolean;
}): Promise<{ resumo: string } | { error: string }> {
  const limite = opts.limite ?? 40;
  const admin = createAdminClient();

  const { data: lead, error: leadErr } = await admin
    .from("leads")
    .select("nome, telefone")
    .eq("id", opts.leadId)
    .single();
  if (leadErr || !lead) return { error: "Lead nao encontrado" };

  const { data: mensagens, error: msgErr } = await admin
    .from("mensagens")
    .select("conteudo, direcao, tipo, created_at")
    .eq("lead_id", opts.leadId)
    .order("created_at", { ascending: true })
    .limit(limite);
  if (msgErr) return { error: msgErr.message };
  if (!mensagens || mensagens.length === 0) {
    return { error: "Lead sem mensagens pra resumir" };
  }

  const transcript = mensagens
    .map((m) => {
      const quem = m.direcao === "entrada" ? lead.nome ?? "Lead" : "Caio";
      const conteudo =
        m.tipo !== "texto"
          ? `[${m.tipo}${m.conteudo ? `: ${m.conteudo}` : ""}]`
          : m.conteudo ?? "";
      return `${quem}: ${conteudo}`;
    })
    .join("\n");

  const result = await chatCompletion({
    messages: [
      { role: "system", content: RESUMO_PROMPT },
      {
        role: "user",
        content: `Lead: ${lead.nome ?? "(sem nome)"} (${lead.telefone})\n\nConversa:\n${transcript}\n\nGere o resumo:`,
      },
    ],
    temperature: 0.3,
    max_tokens: 400,
  });

  if ("error" in result) {
    return { error: `Falha na OpenAI: ${result.error}` };
  }

  if (opts.salvar) {
    await admin
      .from("leads")
      .update({
        resumo_ia: result.content,
        resumo_gerado_em: new Date().toISOString(),
      })
      .eq("id", opts.leadId);
  }

  return { resumo: result.content };
}
