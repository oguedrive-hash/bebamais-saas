import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalizarConfig } from "@/lib/atendimento/regras";
import { FormAssistente } from "./form";

export default async function AssistentePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { data: org } = await createAdminClient()
    .from("organizations")
    .select("id, name, base_conhecimento, atendimento_config, respostas_rapidas")
    .eq("id", id)
    .maybeSingle();
  if (!org) notFound();
  const respostas = Array.isArray(org.respostas_rapidas)
    ? org.respostas_rapidas.filter((r: unknown): r is string => typeof r === "string")
    : [];

  return (
    <div className="max-w-3xl">
      <h1 className="text-4xl font-heading font-bold text-preto">Assistente</h1>
      <p className="text-sm text-cinza-medio mt-1 mb-8">
        O assistente responde o cliente na hora, entende o que ele precisa e passa a conversa para uma atendente.
        Ele nunca passa preço nem fecha pedido.
      </p>
      <FormAssistente
        orgId={org.id}
        informacoesIniciais={org.base_conhecimento ?? ""}
        configInicial={normalizarConfig(org.atendimento_config)}
        respostasIniciais={respostas}
      />
    </div>
  );
}
