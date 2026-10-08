import { redirect, notFound } from "next/navigation";

/** /admin vai direto para as configurações do assistente da empresa (single-tenant). */
export default async function AdminPage() {
  const orgId = process.env.DEFAULT_ORG_ID;
  if (!orgId) notFound();
  redirect(`/admin/clientes/${orgId}/assistente`);
}
