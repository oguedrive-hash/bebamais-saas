import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { STATUS_CONFIG, type StatusLead } from "@/lib/status-config";

type LeadRow = {
  organization_id: string;
  status: string;
  created_at: string;
};

type OrgRow = {
  id: string;
  name: string;
  plano: string;
  ativo: boolean;
  inadimplente: boolean;
  created_at: string;
};

const PLANO_LABEL: Record<string, string> = {
  mensal_basico: "Básico",
  mensal_pro: "Pro",
  mensal_enterprise: "Enterprise",
};

export default async function MetricasGlobaisPage() {
  const supabase = await createClient();

  const [
    { data: orgs },
    { data: leads },
    { count: totalAgendamentos },
  ] = await Promise.all([
    supabase
      .from("organizations")
      .select("id, name, plano, ativo, inadimplente, created_at"),
    supabase
      .from("leads")
      .select("organization_id, status, created_at"),
    supabase
      .from("agendamentos")
      .select("*", { count: "exact", head: true }),
  ]);

  const orgsList = (orgs ?? []) as OrgRow[];
  const leadsList = (leads ?? []) as LeadRow[];

  const totalClientes = orgsList.length;
  const clientesAtivos = orgsList.filter(
    (o) => o.ativo && !o.inadimplente,
  ).length;
  const inadimplentes = orgsList.filter((o) => o.inadimplente).length;
  const pausados = orgsList.filter((o) => !o.ativo).length;
  const totalLeads = leadsList.length;

  // Leads por status global
  const leadsPorStatus: Record<string, number> = {};
  leadsList.forEach((l) => {
    leadsPorStatus[l.status] = (leadsPorStatus[l.status] ?? 0) + 1;
  });

  // Orgs por plano
  const orgsPorPlano: Record<string, number> = {};
  orgsList.forEach((o) => {
    orgsPorPlano[o.plano] = (orgsPorPlano[o.plano] ?? 0) + 1;
  });

  // Top clientes por # de leads
  const leadsPorOrg: Record<string, { total: number; fechou: number; perdido: number }> = {};
  leadsList.forEach((l) => {
    if (!leadsPorOrg[l.organization_id]) {
      leadsPorOrg[l.organization_id] = { total: 0, fechou: 0, perdido: 0 };
    }
    leadsPorOrg[l.organization_id].total++;
    if (l.status === "fechou") leadsPorOrg[l.organization_id].fechou++;
    if (l.status === "perdido") leadsPorOrg[l.organization_id].perdido++;
  });

  const orgsRanked = orgsList
    .map((o) => {
      const m = leadsPorOrg[o.id] ?? { total: 0, fechou: 0, perdido: 0 };
      const concluidos = m.fechou + m.perdido;
      const taxa = concluidos > 0 ? (m.fechou / concluidos) * 100 : 0;
      return { org: o, total: m.total, fechou: m.fechou, taxa };
    })
    .filter((r) => r.total > 0);

  const topPorLeads = orgsRanked
    .slice()
    .sort((a, b) => b.total - a.total)
    .slice(0, 10);
  const topPorConversao = orgsRanked
    .slice()
    .filter((r) => r.fechou > 0)
    .sort((a, b) => b.taxa - a.taxa)
    .slice(0, 10);

  // Leads por mês (últimos 6 meses)
  const hoje = new Date();
  const meses: { rotulo: string; chave: string; total: number }[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(hoje.getFullYear(), hoje.getMonth() - i, 1);
    const chave = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    meses.push({
      rotulo: d.toLocaleDateString("pt-BR", { month: "short" }),
      chave,
      total: 0,
    });
  }
  leadsList.forEach((l) => {
    const d = new Date(l.created_at);
    const chave = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const m = meses.find((m) => m.chave === chave);
    if (m) m.total++;
  });
  const maxMes = Math.max(...meses.map((m) => m.total), 1);

  // Alerta: clientes ativos sem nenhum lead nos últimos 14 dias
  const corte14 = new Date();
  corte14.setDate(corte14.getDate() - 14);
  const corte14Iso = corte14.toISOString();
  const orgsComLeadsRecentes = new Set(
    leadsList.filter((l) => l.created_at >= corte14Iso).map((l) => l.organization_id),
  );
  const clientesInativos = orgsList.filter(
    (o) =>
      o.ativo &&
      !o.inadimplente &&
      !orgsComLeadsRecentes.has(o.id),
  );

  return (
    <div>
      <PageHeader
        titulo="Métricas globais"
        descricao="Visão consolidada de todos os clientes da Beba Mais"
      />

      {/* Métricas principais */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
        <MetricaBig label="Total clientes" valor={totalClientes} />
        <MetricaBig label="Ativos" valor={clientesAtivos} accent="emerald" />
        <MetricaBig label="Pausados" valor={pausados} accent="amber" />
        <MetricaBig label="Inadimplentes" valor={inadimplentes} accent="red" />
        <MetricaBig label="Agendamentos" valor={totalAgendamentos ?? 0} accent="blue" />
      </div>

      {/* Alerta de clientes sem leads recentes */}
      {clientesInativos.length > 0 && (
        <div className="mb-6 p-4 bg-amber-50 border border-amber-200 rounded-2xl">
          <p className="text-sm font-heading font-semibold text-amber-900 mb-2">
            ⚠ {clientesInativos.length} cliente(s) ativo(s) sem leads nos últimos 14 dias
          </p>
          <div className="flex flex-wrap gap-2">
            {clientesInativos.slice(0, 10).map((o) => (
              <Link
                key={o.id}
                href={`/admin/clientes/${o.id}`}
                className="px-3 py-1.5 rounded-full text-xs font-heading font-semibold bg-white border border-amber-200 text-amber-800 hover:bg-amber-100 transition"
              >
                {o.name}
              </Link>
            ))}
            {clientesInativos.length > 10 && (
              <span className="text-xs text-amber-800 self-center">
                +{clientesInativos.length - 10}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Gráfico de leads por mês */}
      <Card titulo="Leads novos — últimos 6 meses" className="mb-6">
        <div className="flex items-end gap-3 h-44">
          {meses.map((m) => {
            const altura = (m.total / maxMes) * 100;
            return (
              <div
                key={m.chave}
                className="flex-1 flex flex-col items-center justify-end gap-2"
              >
                <span className="text-xs font-heading font-semibold text-preto">
                  {m.total}
                </span>
                <div
                  className="w-full bg-laranja rounded-t-md transition"
                  style={{ height: `${altura}%`, minHeight: "4px" }}
                />
                <span className="text-[10px] text-cinza-medio uppercase tracking-wider">
                  {m.rotulo}
                </span>
              </div>
            );
          })}
        </div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* Top clientes por leads */}
        <Card titulo="Top 10 clientes — por volume de leads">
          {topPorLeads.length === 0 ? (
            <p className="text-sm text-cinza-medio text-center py-6">
              Nenhum cliente com leads ainda.
            </p>
          ) : (
            <ol className="space-y-2">
              {topPorLeads.map((r, i) => (
                <li key={r.org.id}>
                  <Link
                    href={`/admin/clientes/${r.org.id}`}
                    className="flex items-center justify-between gap-3 p-2 rounded-lg hover:bg-offwhite transition"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-xs font-mono text-cinza-medio w-5">
                        {i + 1}.
                      </span>
                      <span className="text-sm font-heading font-semibold text-preto truncate">
                        {r.org.name}
                      </span>
                    </div>
                    <span className="text-sm font-heading font-bold text-laranja">
                      {r.total}
                    </span>
                  </Link>
                </li>
              ))}
            </ol>
          )}
        </Card>

        {/* Top por conversão */}
        <Card titulo="Top 10 — por taxa de conversão">
          {topPorConversao.length === 0 ? (
            <p className="text-sm text-cinza-medio text-center py-6">
              Nenhum cliente com lead fechado ainda.
            </p>
          ) : (
            <ol className="space-y-2">
              {topPorConversao.map((r, i) => (
                <li key={r.org.id}>
                  <Link
                    href={`/admin/clientes/${r.org.id}`}
                    className="flex items-center justify-between gap-3 p-2 rounded-lg hover:bg-offwhite transition"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-xs font-mono text-cinza-medio w-5">
                        {i + 1}.
                      </span>
                      <span className="text-sm font-heading font-semibold text-preto truncate">
                        {r.org.name}
                      </span>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <span className="text-sm font-heading font-bold text-emerald-700">
                        {r.taxa.toFixed(0)}%
                      </span>
                      <p className="text-[10px] text-cinza-medio">
                        {r.fechou} fechou / {r.total} total
                      </p>
                    </div>
                  </Link>
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Leads por status global */}
        <Card titulo="Leads por status (todos clientes)">
          {Object.keys(leadsPorStatus).length === 0 ? (
            <p className="text-sm text-cinza-medio text-center py-6">
              Nenhum lead capturado ainda.
            </p>
          ) : (
            <div className="space-y-2">
              {(Object.keys(STATUS_CONFIG) as StatusLead[])
                .sort((a, b) => STATUS_CONFIG[a].ordem - STATUS_CONFIG[b].ordem)
                .filter((s) => (leadsPorStatus[s] ?? 0) > 0)
                .map((s) => {
                  const valor = leadsPorStatus[s] ?? 0;
                  const pct = Math.round((valor / Math.max(totalLeads, 1)) * 100);
                  return (
                    <div key={s}>
                      <div className="flex items-center justify-between text-sm mb-1">
                        <span className="font-heading font-medium text-preto">
                          {STATUS_CONFIG[s].label}
                        </span>
                        <span className="text-cinza-medio">
                          {valor} <span className="text-xs">({pct}%)</span>
                        </span>
                      </div>
                      <div className="w-full h-2 bg-cinza-claro rounded-full overflow-hidden">
                        <div
                          className={`h-full ${STATUS_CONFIG[s].barra}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
            </div>
          )}
        </Card>

        {/* Clientes por plano */}
        <Card titulo="Clientes por plano">
          {Object.keys(orgsPorPlano).length === 0 ? (
            <p className="text-sm text-cinza-medio text-center py-6">
              Nenhum cliente cadastrado ainda.
            </p>
          ) : (
            <div className="space-y-3">
              {Object.entries(orgsPorPlano).map(([plano, valor]) => (
                <div
                  key={plano}
                  className="flex items-center justify-between p-3 bg-offwhite rounded-lg"
                >
                  <span className="font-heading font-medium text-preto">
                    {PLANO_LABEL[plano] ?? plano}
                  </span>
                  <span className="text-2xl font-heading font-bold text-laranja">
                    {valor}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

function MetricaBig({
  label,
  valor,
  accent = "default",
}: {
  label: string;
  valor: number;
  accent?: "default" | "emerald" | "red" | "blue" | "amber";
}) {
  const accents = {
    default: "text-preto",
    emerald: "text-emerald-600",
    red: "text-red-600",
    blue: "text-blue-600",
    amber: "text-amber-600",
  };
  return (
    <div className="bg-white rounded-2xl border border-cinza-claro p-5">
      <p className="text-xs font-heading font-semibold text-cinza-medio uppercase tracking-wider mb-1">
        {label}
      </p>
      <p className={`text-3xl font-heading font-bold ${accents[accent]}`}>
        {valor}
      </p>
    </div>
  );
}

function Card({
  titulo,
  children,
  className = "",
}: {
  titulo: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`bg-white rounded-2xl border border-cinza-claro p-6 ${className}`}
    >
      <h2 className="text-sm font-heading font-bold text-preto mb-4 uppercase tracking-wider">
        {titulo}
      </h2>
      {children}
    </div>
  );
}
