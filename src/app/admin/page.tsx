import { redirect, notFound } from "next/navigation";
import { getFacilitaOrgFallback } from "@/lib/caio/tenant";

/**
 * Single-tenant: /admin NÃO lista clientes — vai direto pra config da org única.
 * Resolve via DEFAULT_ORG_ID (cada clone seta a sua) com fallback pra org Facilita.
 */
export default async function AdminPage() {
  const orgId = process.env.DEFAULT_ORG_ID ?? (await getFacilitaOrgFallback())?.id;
  if (!orgId) {
    notFound();
  }
  redirect(`/admin/clientes/${orgId}`);
}
