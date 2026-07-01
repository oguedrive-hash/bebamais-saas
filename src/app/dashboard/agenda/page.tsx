import { cookies } from "next/headers";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { CalendarioAgenda } from "@/components/calendario-agenda";
import { StatusAgendamentoSelector } from "@/components/status-agendamento-selector";
import { BotaoNovoAgendamento } from "@/components/botao-novo-agendamento";
import { BotaoDeletarAgendamento } from "@/components/botao-deletar-agendamento";
import { getAgendaConfigDaOrg } from "@/app/dashboard/agenda/actions";

type View = "lista" | "calendario";

type LeadRef =
  | { nome?: string | null; telefone?: string }
  | { nome?: string | null; telefone?: string }[]
  | null;

type AgendamentoDB = {
  id: string;
  data_inicio: string;
  data_fim?: string | null;
  status: string;
  meet_link?: string | null;
  lead_id: string;
  leads: LeadRef;
};

export default async function AgendaPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: View }>;
}) {
  const params = await searchParams;
  const cookieStore = await cookies();
  const viewSalva = cookieStore.get("agenda_view_preferida")?.value;
  const view: View =
    params.view === "calendario" || params.view === "lista"
      ? params.view
      : viewSalva === "calendario"
        ? "calendario"
        : "lista";

  const supabase = await createClient();
  const agora = new Date();
  const trintaDiasAtras = new Date(agora);
  trintaDiasAtras.setDate(trintaDiasAtras.getDate() - 30);

  // Config da agenda da org — usado pelo botão "Novo agendamento" pra mostrar
  // as durações pré-setadas (ex: 30, 60, 90 min). User configura em
  // /dashboard/agenda/config.
  const { config: agendaConfig } = await getAgendaConfigDaOrg();

  if (view === "calendario") {
    // Calendário: pega tudo do mês atual + adjacentes (janela ampla pra navegar)
    const inicioJanela = new Date(agora);
    inicioJanela.setMonth(inicioJanela.getMonth() - 2);
    inicioJanela.setDate(1);
    const fimJanela = new Date(agora);
    fimJanela.setMonth(fimJanela.getMonth() + 3);

    const { data: agendamentos } = await supabase
      .from("agendamentos")
      .select(
        "id, data_inicio, status, lead_id, leads(nome, telefone)",
      )
      .gte("data_inicio", inicioJanela.toISOString())
      .lte("data_inicio", fimJanela.toISOString())
      .order("data_inicio", { ascending: true })
      .limit(500);

    const lista = (agendamentos ?? []).map((a) => {
      const leadRef = a.leads as LeadRef;
      const lead = Array.isArray(leadRef) ? leadRef[0] : leadRef;
      return {
        id: a.id,
        data_inicio: a.data_inicio,
        status: a.status,
        lead_id: a.lead_id,
        lead_nome: lead?.nome ?? null,
        lead_telefone: lead?.telefone ?? "",
      };
    });

    return (
      <div>
        <div className="flex items-center justify-between gap-3 mb-6">
          <PageHeader
            titulo="Retiradas"
            descricao="Pedidos com retirada agendada pelo Caio"
          />
          <div className="flex items-center gap-3">
            <ViewToggle viewAtual={view} />
            <Link
              href="/dashboard/agenda/config"
              className="px-3 py-2 rounded-lg border border-cinza-claro bg-white text-cinza-medio hover:text-preto hover:border-preto font-heading font-semibold text-sm transition"
              title="Configurar slots e dias de trabalho"
            >
              ⚙️
            </Link>
            <BotaoNovoAgendamento duracoesConfig={agendaConfig.duracoes} />
          </div>
        </div>
        <CalendarioAgenda agendamentos={lista} />
      </div>
    );
  }

  // View Lista (default)
  const [{ data: proximosAgendamentos }, { data: agendamentosPassados }] =
    await Promise.all([
      supabase
        .from("agendamentos")
        .select(
          "id, data_inicio, data_fim, status, meet_link, lead_id, leads(nome, telefone)",
        )
        .gte("data_inicio", agora.toISOString())
        .order("data_inicio", { ascending: true })
        .limit(50),
      supabase
        .from("agendamentos")
        .select(
          "id, data_inicio, data_fim, status, meet_link, lead_id, leads(nome, telefone)",
        )
        .lt("data_inicio", agora.toISOString())
        .gte("data_inicio", trintaDiasAtras.toISOString())
        .order("data_inicio", { ascending: false })
        .limit(30),
    ]);

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-6">
        <PageHeader
          titulo="Agenda"
          descricao="Retiradas agendadas pelo Caio"
        />
        <ViewToggle viewAtual={view} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <h2 className="text-lg font-heading font-bold text-preto mb-4">
            Próximas retiradas
          </h2>
          {!proximosAgendamentos || proximosAgendamentos.length === 0 ? (
            <EmptyState
              icone="📅"
              titulo="Nenhuma retirada agendada"
              descricao="Quando o Caio agendar uma retirada, vai aparecer aqui."
            />
          ) : (
            <div className="space-y-3">
              {(proximosAgendamentos as AgendamentoDB[]).map((a) => (
                <AgendamentoCard key={a.id} agendamento={a} destaque />
              ))}
            </div>
          )}
        </div>

        <div>
          <h2 className="text-lg font-heading font-bold text-preto mb-4">
            Últimos 30 dias
          </h2>
          {!agendamentosPassados || agendamentosPassados.length === 0 ? (
            <div className="bg-white rounded-2xl border border-cinza-claro p-6 text-center">
              <p className="text-sm text-cinza-medio">
                Sem histórico nos últimos 30 dias.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {(agendamentosPassados as AgendamentoDB[]).map((a) => (
                <AgendamentoCard key={a.id} agendamento={a} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ViewToggle({ viewAtual }: { viewAtual: View }) {
  return (
    <div className="inline-flex rounded-lg border border-cinza-claro overflow-hidden">
      <Link
        href="/dashboard/agenda?view=lista"
        className={`px-3 py-2 text-sm font-heading font-semibold transition border-r border-cinza-claro flex items-center gap-1.5 ${
          viewAtual === "lista"
            ? "bg-preto text-white"
            : "bg-white text-cinza-medio hover:text-preto"
        }`}
      >
        Lista
      </Link>
      <Link
        href="/dashboard/agenda?view=calendario"
        className={`px-3 py-2 text-sm font-heading font-semibold transition flex items-center gap-1.5 ${
          viewAtual === "calendario"
            ? "bg-preto text-white"
            : "bg-white text-cinza-medio hover:text-preto"
        }`}
      >
        Calendário
      </Link>
    </div>
  );
}

function AgendamentoCard({
  agendamento,
  destaque = false,
}: {
  agendamento: AgendamentoDB;
  destaque?: boolean;
}) {
  const leadRef = agendamento.leads;
  const lead = Array.isArray(leadRef) ? leadRef[0] : leadRef;
  const data = new Date(agendamento.data_inicio);
  const diffMs = data.getTime() - Date.now();
  const ehFuturo = diffMs > 0;
  const tempoRelativo = ehFuturo ? tempoAteFuturo(diffMs) : null;

  return (
    <div
      className={`bg-white rounded-xl border p-4 ${
        destaque ? "border-laranja/30" : "border-cinza-claro"
      }`}
    >
      <div className="flex items-start justify-between gap-3 mb-2">
        <div>
          <p className="font-heading font-semibold text-preto">
            {lead?.nome ?? "Sem nome"}
          </p>
          <p className="text-xs text-cinza-medio font-mono mt-0.5">
            {lead?.telefone}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <StatusAgendamentoSelector
            agendamentoId={agendamento.id}
            statusAtual={agendamento.status}
          />
          <BotaoDeletarAgendamento
            agendamentoId={agendamento.id}
            leadNome={lead?.nome ?? null}
            dataInicio={agendamento.data_inicio}
          />
        </div>
      </div>

      <div className="flex items-center gap-2 mb-2">
        <span className="text-sm font-heading font-semibold text-laranja">
          {data.toLocaleDateString("pt-BR", {
            day: "2-digit",
            month: "short",
            weekday: "short",
          })}
        </span>
        <span className="text-cinza-claro">•</span>
        <span className="text-sm text-cinza-medio">
          {data.toLocaleTimeString("pt-BR", {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </span>
        {tempoRelativo && (
          <>
            <span className="text-cinza-claro">•</span>
            <span className="text-xs text-emerald-700 font-heading font-semibold">
              em {tempoRelativo}
            </span>
          </>
        )}
      </div>

      <div className="flex items-center justify-between gap-2">
        {agendamento.meet_link ? (
          <a
            href={agendamento.meet_link}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-laranja hover:underline font-heading font-semibold"
          >
            Link →
          </a>
        ) : (
          <span className="text-xs text-cinza-medio">Sem link</span>
        )}
        <Link
          href={`/dashboard/contatos/${agendamento.lead_id}`}
          className="text-xs text-cinza-medio hover:text-laranja font-heading font-medium"
        >
          Ver contato
        </Link>
      </div>
    </div>
  );
}

function tempoAteFuturo(diffMs: number): string {
  const diffMin = Math.floor(diffMs / 60000);
  const diffHrs = Math.floor(diffMs / 3600000);
  const diffDias = Math.floor(diffMs / 86400000);
  if (diffMin < 60) return `${diffMin}min`;
  if (diffHrs < 24) return `${diffHrs}h`;
  if (diffDias < 7) return `${diffDias}d`;
  return `${Math.floor(diffDias / 7)}sem`;
}
