import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { RetomadaForm } from "./form";
import type { RetomadaConfig, TipoMidia } from "../actions";

export default async function RetomadaPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: cliente, error } = await supabase
    .from("organizations")
    .select(
      "id, mensagem_retomada, mensagem_retomada_usa_ia, mensagem_retomada_tipo_midia, mensagem_retomada_attachment_url, mensagem_retomada_attachment_mime",
    )
    .eq("id", id)
    .single();

  if (error || !cliente) notFound();

  const retomadaInicial: RetomadaConfig = {
    mensagem:
      cliente.mensagem_retomada ??
      "Oi {nome}! Como combinamos, voltando ao contato. Posso te ajudar a montar seu pedido?",
    usa_ia: cliente.mensagem_retomada_usa_ia ?? false,
    tipo_midia:
      (cliente.mensagem_retomada_tipo_midia as TipoMidia | null) ?? "texto",
    attachment_url: cliente.mensagem_retomada_attachment_url ?? null,
    attachment_mime: cliente.mensagem_retomada_attachment_mime ?? null,
  };

  return (
    <RetomadaForm
      organizationId={cliente.id}
      retomadaInicial={retomadaInicial}
    />
  );
}
