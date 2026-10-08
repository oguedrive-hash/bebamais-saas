import { redirect } from "next/navigation";

/** Página antiga de detalhes do cliente: agora leva para as configurações do assistente. */
export default async function ClienteDetalhePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/admin/clientes/${id}/assistente`);
}
