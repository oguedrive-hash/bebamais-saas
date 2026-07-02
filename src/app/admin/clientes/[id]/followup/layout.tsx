import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { FollowupTabsNav } from "./_shared/tabs-nav";

export default async function FollowupLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: cliente, error } = await supabase
    .from("organizations")
    .select("id, name")
    .eq("id", id)
    .single();

  if (error || !cliente) {
    notFound();
  }

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
          Cadência de follow-up
        </h1>
        <p className="text-sm text-cinza-medio mt-1">
          {cliente.name} — como a IA insiste com leads que param de responder
        </p>
      </div>

      <FollowupTabsNav clienteId={cliente.id} />

      <div className="bg-white rounded-2xl border border-cinza-claro p-8">
        {children}
      </div>
    </div>
  );
}
