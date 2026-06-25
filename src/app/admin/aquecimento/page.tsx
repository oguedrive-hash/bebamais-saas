import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { getFacilitaOrgFallback } from "@/lib/caio/tenant";
import { listarAquecimento } from "./actions";
import { AquecimentoManager } from "./form";

// Aba do AQUECEDOR de chip. Single-tenant: resolve a org única via env (ou fallback).
export default async function AquecimentoPage() {
  const orgId = process.env.DEFAULT_ORG_ID ?? (await getFacilitaOrgFallback())?.id;
  if (!orgId) {
    notFound();
  }

  const res = await listarAquecimento(orgId);
  const numeros = "error" in res ? [] : res.numeros;
  const erro = "error" in res ? res.error : null;

  return (
    <div>
      <PageHeader
        titulo="Aquecedor de chip"
        descricao="Matura número novo com tráfego natural antes de jogar lead. Âncoras (números já maduros) conversam com os chips novos; o volume sobe por rampa até ficar 🔴 Quente — aí é só puxar pro Caio."
      />
      <AquecimentoManager organizationId={orgId} inicial={numeros} erroInicial={erro} />
    </div>
  );
}
