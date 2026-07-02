import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { CaioForm } from "./form";

export default async function CaioConfigPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: cliente, error } = await supabase
    .from("organizations")
    .select(
      "id, name, prompt_system, prompt_system_prospeccao, base_conhecimento",
    )
    .eq("id", id)
    .single();

  if (error || !cliente) notFound();

  return (
    <div className="max-w-4xl">
      <Link
        href={`/admin/clientes/${id}`}
        className="inline-flex items-center text-sm text-cinza-medio hover:text-laranja font-heading font-medium mb-4 transition"
      >
        ← Voltar pros detalhes
      </Link>

      <div className="mb-8">
        <h1 className="text-4xl font-heading font-bold text-preto">
          Configuração do Atendente IA
        </h1>
        <p className="text-sm text-cinza-medio mt-1">
          {cliente.name} — comportamento por canal e base de conhecimento
        </p>
      </div>

      <CaioForm
        organizationId={cliente.id}
        comportamentoInbound={cliente.prompt_system ?? ""}
        comportamentoProspeccao={cliente.prompt_system_prospeccao ?? ""}
        baseConhecimento={cliente.base_conhecimento ?? ""}
      />
    </div>
  );
}
