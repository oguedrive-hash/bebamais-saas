import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { listarNumeros } from "./actions";
import { NumerosManager } from "./form";

export default async function NumerosPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: cliente, error } = await supabase
    .from("organizations")
    .select("id, name")
    .eq("id", id)
    .single();

  if (error || !cliente) notFound();

  const res = await listarNumeros(id);
  const numeros = "numeros" in res ? res.numeros : [];
  const erroInicial = "error" in res ? res.error : null;

  return (
    <div className="max-w-4xl">
      <div className="mb-8">
        <h1 className="text-4xl font-heading font-bold text-preto">
          Números de WhatsApp
        </h1>
        <p className="text-sm text-cinza-medio mt-1">
          {cliente.name} — todos os números caem no mesmo painel de atendimento.
          A resposta sai sempre pelo número em que o cliente escreveu.
        </p>
      </div>

      <NumerosManager
        organizationId={cliente.id}
        inicial={numeros}
        erroInicial={erroInicial}
      />
    </div>
  );
}
