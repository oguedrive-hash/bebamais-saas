import { redirect, notFound } from "next/navigation";
import { getFacilitaOrgFallback } from "@/lib/caio/tenant";

/**
 * Single-tenant: /admin NÃO lista clientes — vai DIRETO pra config do Caio
 * da org única (a tela de config mais usada). O hub de detalhes continua em
 * /admin/clientes/[id] (alvo dos "voltar" das sub-telas).
 * Resolve via DEFAULT_ORG_ID (cada clone seta a sua) com fallback pra org Facilita.
 */
export default async function AdminPage() {
  const orgId = process.env.DEFAULT_ORG_ID ?? (await getFacilitaOrgFallback())?.id;
  if (!orgId) {
    notFound();
  }
  redirect(`/admin/clientes/${orgId}/caio`);
}
