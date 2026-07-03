import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { getAgendaConfigDaOrg } from "@/app/dashboard/agenda/actions";
import { AgendaConfigForm } from "./form";

export default async function AgendaConfigPage() {
  const { config } = await getAgendaConfigDaOrg();

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-4">
        <PageHeader
          titulo="Configuração das Retiradas"
          descricao="Dias e horários que a operação trabalha — usado pra propor horários de retirada"
        />
        <Link
          href="/dashboard/agenda"
          className="text-sm text-cinza-medio hover:text-preto font-heading font-semibold transition"
        >
          ← Voltar pra Retiradas
        </Link>
      </div>

      <AgendaConfigForm configInicial={config} />
    </div>
  );
}
