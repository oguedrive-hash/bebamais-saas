import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import {
  STATUS_CONFIG,
  STATUS_ORDEM,
  type StatusLead,
} from "@/lib/status-config";

type Lead = {
  id: string;
  nome: string | null;
  telefone: string;
  status: string;
  caio_ativo: boolean | null;
  desqualificado?: boolean | null;
  desqualificacao_motivo?: string | null;
  created_at: string;
  updated_at: string;
};

type MsgAggregate = {
  lead_id: string;
  direcao: "entrada" | "saida";
  created_at: string;
};

export default async function DashboardPage() {
  const supabase = await createClient();

  // Janelas de tempo pra comparação
  const agora = new Date();
  const inicio7d = new Date(agora);
  inicio7d.setDate(inicio7d.getDate() - 7);
  const inicio14d = new Date(agora);
  inicio14d.setDate(inicio14d.getDate() - 14);

  const [{ data: leads }, { data: msgsRecentes }] = await Promise.all([
    supabase
      .from("leads")
      .select(
        "id, nome, telefone, status, caio_ativo, desqualificado, desqualificacao_motivo, created_at, updated_at",
      )
      .eq("origem", "inbound"),
    // Mensagens últimos 7d pra hora de pico + tempo de resposta
    supabase
      .from("mensagens")
      .select("lead_id, direcao, created_at")
      .gte("created_at", inicio14d.toISOString())
      .limit(5000),
  ]);

  const total = leads?.length ?? 0;
  const porStatus: Record<string, number> = {};
  STATUS_ORDEM.forEach((s) => (porStatus[s] = 0));
  leads?.forEach((l) => {
    porStatus[l.status] = (porStatus[l.status] ?? 0) + 1;
  });

  const emConversa = porStatus.em_conversa ?? 0;
  const reuniao = porStatus.reuniao_agendada ?? 0;
  const fechou = porStatus.fechou ?? 0;
  const perdido = porStatus.perdido ?? 0;
  const concluidos = fechou + perdido;
  const taxaConversao = concluidos > 0 ? (fechou / concluidos) * 100 : 0;
  const caioOff = leads?.filter((l) => !l.caio_ativo).length ?? 0;

  // === Funil BANT (qualificacao) ===
  const agendados = reuniao + fechou; // chegaram a marcar reuniao
  const desqualificados = leads?.filter((l) => l.desqualificado).length ?? 0;
  const aindaConversando = porStatus.em_conversa ?? 0;
  const totalProcessados = agendados + desqualificados;
  const taxaAgendamento =
    totalProcessados > 0 ? (agendados / totalProcessados) * 100 : 0;
  // Motivos de desqualificacao
  const motivos: Record<string, number> = {};
  leads?.forEach((l) => {
    if (l.desqualificado && l.desqualificacao_motivo) {
      motivos[l.desqualificacao_motivo] =
        (motivos[l.desqualificacao_motivo] ?? 0) + 1;
    }
  });

  // Comparação semana atual vs semana anterior
  const leadsSemanaAtual = countNaJanela(leads, inicio7d, agora);
  const leadsSemanaAnterior = countNaJanela(leads, inicio14d, inicio7d);
  const deltaSemana = pctDelta(leadsSemanaAtual, leadsSemanaAnterior);

  // Leads dos últimos 7 dias agrupados por dia
  const hojeFim = new Date(agora);
  hojeFim.setHours(23, 59, 59, 999);
  const dias: { dia: string; label: string; quantidade: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(hojeFim);
    d.setDate(d.getDate() - i);
    d.setHours(0, 0, 0, 0);
    const dEnd = new Date(d);
    dEnd.setHours(23, 59, 59, 999);
    const count = countNaJanela(leads, d, dEnd);
    dias.push({
      dia: d.toISOString().slice(0, 10),
      label: d.toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit" }),
      quantidade: count,
    });
  }
  const maxDia = Math.max(...dias.map((d) => d.quantidade), 1);

  // Hora de pico — distribuição de mensagens incoming por hora do dia
  const porHora: Record<number, number> = {};
  for (let h = 0; h < 24; h++) porHora[h] = 0;
  (msgsRecentes ?? []).forEach((m) => {
    if (m.direcao !== "entrada") return;
    const h = new Date(m.created_at).getHours();
    porHora[h] = (porHora[h] ?? 0) + 1;
  });
  const maxHora = Math.max(...Object.values(porHora), 1);
  const horaPicoNum = Object.entries(porHora).sort(
    (a, b) => b[1] - a[1],
  )[0]?.[0];

  // Tempo médio até 1ª resposta do Caio (em segundos)
  const tempoResposta = calcularTempoResposta((msgsRecentes ?? []) as MsgAggregate[]);

  // Funil: novo_lead → em_conversa → reuniao_agendada → fechou
  const funilOrdem: StatusLead[] = [
    "novo_lead",
    "em_conversa",
    "followup",
    "reuniao_agendada",
    "fechou",
  ];
  const funil = funilOrdem.map((s) => ({
    status: s,
    label: STATUS_CONFIG[s].label,
    cor: STATUS_CONFIG[s].cor,
    barra: STATUS_CONFIG[s].barra,
    quantidade: porStatus[s] ?? 0,
  }));
  const maxFunil = Math.max(...funil.map((f) => f.quantidade), 1);

  // Leads recentes
  const leadsRecentes = (leads ?? [])
    .slice()
    .sort(
      (a, b) =>
        new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
    )
    .slice(0, 5);

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-4xl font-heading font-bold text-preto">Dashboard</h1>
        <p className="text-sm text-cinza-medio mt-1">
          Visão geral do seu atendente IA
        </p>
      </div>

      {/* Linha 1: métricas com delta */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <MetricCard
          titulo="Total de leads"
          valor={total}
        />
        <MetricCard
          titulo="Leads esta semana"
          valor={leadsSemanaAtual}
          delta={deltaSemana}
          descricao="vs semana anterior"
        />
        <MetricCard
          titulo="Retiradas agendadas"
          valor={reuniao}
        />
        <MetricCard
          titulo="Taxa de conversão"
          valor={taxaConversao}
          sufixo="%"
          descricao={`${fechou} fechou / ${perdido} perdeu`}
          destaque
        />
      </div>

      {/* Linha 2: tempo resposta + em conversa + Caio status */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-8">
        <MetricCard
          titulo="Em conversa agora"
          valor={emConversa}
        />
        <MetricCard
          titulo="Tempo médio de resposta"
          valor={tempoResposta.valor}
          sufixo={tempoResposta.unidade}
          descricao="Caio respondendo"
        />
        <MetricCard
          titulo="Humano assumiu"
          valor={caioOff}
          descricao="Caio desligado nesses leads"
        />
      </div>

      {/* Linha 3: gráfico semana + hora de pico */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <Card titulo="Leads novos — últimos 7 dias">
          <div className="flex items-end gap-3 h-44">
            {dias.map((d) => {
              const altura = (d.quantidade / maxDia) * 100;
              return (
                <div
                  key={d.dia}
                  className="flex-1 flex flex-col items-center justify-end gap-2"
                >
                  <span className="text-xs font-heading font-semibold text-preto">
                    {d.quantidade}
                  </span>
                  <div
                    className="w-full bg-laranja rounded-t-md transition"
                    style={{ height: `${altura}%`, minHeight: "4px" }}
                  />
                  <span className="text-[10px] text-cinza-medio uppercase tracking-wider">
                    {d.label}
                  </span>
                </div>
              );
            })}
          </div>
        </Card>

        <Card titulo={`Hora de pico ${horaPicoNum != null ? `(pico às ${horaPicoNum}h)` : ""}`}>
          <div className="flex items-end gap-1 h-44">
            {Array.from({ length: 24 }, (_, h) => {
              const v = porHora[h];
              const altura = (v / maxHora) * 100;
              const pico = String(h) === horaPicoNum;
              return (
                <div
                  key={h}
                  className="flex-1 flex flex-col items-center justify-end gap-1"
                  title={`${h}h — ${v} mensagens`}
                >
                  <div
                    className={`w-full rounded-t-sm transition ${
                      pico ? "bg-laranja" : "bg-laranja/30"
                    }`}
                    style={{ height: `${altura}%`, minHeight: "2px" }}
                  />
                  {h % 3 === 0 && (
                    <span className="text-[9px] text-cinza-medio">{h}</span>
                  )}
                </div>
              );
            })}
          </div>
          <p className="text-[10px] text-cinza-medio mt-2 text-center">
            Mensagens recebidas por hora (últimos 14d)
          </p>
        </Card>
      </div>

      {/* Linha 4: funil + distribuição */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <Card titulo="Funil de conversão">
          <ul className="space-y-2">
            {funil.map((f) => {
              const pct = (f.quantidade / maxFunil) * 100;
              return (
                <li key={f.status}>
                  <div className="flex items-center justify-between mb-1">
                    <span className={`text-xs font-heading font-semibold ${f.cor}`}>
                      {f.label}
                    </span>
                    <span className="text-xs text-cinza-medio">
                      {f.quantidade}
                    </span>
                  </div>
                  <div className="h-3 bg-cinza-claro rounded-full overflow-hidden">
                    <div
                      className={`h-full ${f.barra} rounded-full transition`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>

        <Card titulo="Distribuição por status">
          {total === 0 ? (
            <p className="text-sm text-cinza-medio text-center py-10">
              Nenhum lead ainda.
            </p>
          ) : (
            <ul className="space-y-2.5">
              {STATUS_ORDEM.filter((s) => porStatus[s] > 0).map((s) => {
                const config = STATUS_CONFIG[s];
                const count = porStatus[s];
                const pct = (count / total) * 100;
                return (
                  <li key={s}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-heading font-medium text-preto">
                        {config.label}
                      </span>
                      <span className="text-xs text-cinza-medio">
                        {count} ({pct.toFixed(0)}%)
                      </span>
                    </div>
                    <div className="h-2 bg-cinza-claro rounded-full overflow-hidden">
                      <div
                        className={`h-full ${config.barra} rounded-full`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>

      {/* Linha 4.5: Qualificacao BANT */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
        <Card titulo="Qualificação BANT">
          {totalProcessados === 0 ? (
            <p className="text-sm text-cinza-medio text-center py-10">
              Sem conversas processadas ainda.
            </p>
          ) : (
            <div className="space-y-4">
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-heading font-bold text-emerald-600">
                  {taxaAgendamento.toFixed(0)}%
                </span>
                <span className="text-xs text-cinza-medio">
                  taxa de agendamento
                </span>
              </div>
              <div className="space-y-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-emerald-700 font-heading font-semibold">
                    ✓ Agendaram
                  </span>
                  <span className="text-preto font-mono">{agendados}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-amber-700 font-heading font-semibold">
                    ✗ Desqualificados
                  </span>
                  <span className="text-preto font-mono">{desqualificados}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-cinza-medio font-heading">
                    Ainda em conversa
                  </span>
                  <span className="text-preto font-mono">{aindaConversando}</span>
                </div>
              </div>
            </div>
          )}
        </Card>

        <Card titulo="Motivos de desqualificação">
          {desqualificados === 0 ? (
            <p className="text-sm text-cinza-medio text-center py-10">
              Nenhum desqualificado ainda.
            </p>
          ) : (
            <ul className="space-y-2 text-xs">
              {Object.entries(motivos)
                .sort((a, b) => b[1] - a[1])
                .map(([m, c]) => (
                  <li
                    key={m}
                    className="flex items-center justify-between border-b border-cinza-claro/60 pb-2 last:border-b-0"
                  >
                    <span className="text-preto font-heading font-semibold">
                      {labelMotivoDesq(m)}
                    </span>
                    <span className="text-cinza-medio font-mono">{c}</span>
                  </li>
                ))}
            </ul>
          )}
        </Card>

        <Card titulo="Pipeline ativo">
          <ul className="space-y-2 text-xs">
            <li className="flex justify-between">
              <span className="text-blue-700 font-heading font-semibold">
                Em conversa
              </span>
              <span className="text-preto font-mono">{emConversa}</span>
            </li>
            <li className="flex justify-between">
              <span className="text-amber-700 font-heading font-semibold">
                Retirada agendada
              </span>
              <span className="text-preto font-mono">{reuniao}</span>
            </li>
            <li className="flex justify-between">
              <span className="text-emerald-700 font-heading font-semibold">
                Fechou
              </span>
              <span className="text-preto font-mono">{fechou}</span>
            </li>
            <li className="flex justify-between">
              <span className="text-cinza-medio font-heading">Perdido</span>
              <span className="text-preto font-mono">{perdido}</span>
            </li>
          </ul>
        </Card>
      </div>

      {/* Linha 5: atividade recente */}
      <Card titulo="Atividade recente">
        {leadsRecentes.length === 0 ? (
          <p className="text-sm text-cinza-medio text-center py-10">
            Nenhum lead ainda.
          </p>
        ) : (
          <ul className="divide-y divide-cinza-claro">
            {leadsRecentes.map((l) => (
              <li key={l.id}>
                <Link
                  href={`/dashboard/contatos/${l.id}`}
                  className="flex items-center justify-between gap-3 py-3 hover:bg-offwhite/50 transition px-2 -mx-2 rounded-lg"
                >
                  <div className="flex-1 min-w-0">
                    <p className="font-heading font-semibold text-preto truncate">
                      {l.nome ?? "Sem nome"}
                    </p>
                    <p className="text-xs text-cinza-medio font-mono">
                      {l.telefone}
                    </p>
                  </div>
                  <span
                    className={`text-[10px] font-heading font-semibold px-2 py-0.5 rounded-full border ${STATUS_CONFIG[l.status as StatusLead].bg} ${STATUS_CONFIG[l.status as StatusLead].cor} ${STATUS_CONFIG[l.status as StatusLead].border}`}
                  >
                    {STATUS_CONFIG[l.status as StatusLead].label}
                  </span>
                  <span className="text-xs text-cinza-medio whitespace-nowrap">
                    {formatRelative(l.updated_at)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function countNaJanela(
  leads: Lead[] | null | undefined,
  inicio: Date,
  fim: Date,
): number {
  return (
    leads?.filter((l) => {
      const c = new Date(l.created_at);
      return c >= inicio && c < fim;
    }).length ?? 0
  );
}

function pctDelta(atual: number, anterior: number): number | null {
  if (anterior === 0) return atual > 0 ? 100 : null;
  return ((atual - anterior) / anterior) * 100;
}

function calcularTempoResposta(
  mensagens: MsgAggregate[],
): { valor: number; unidade: string } {
  // Pra cada lead, agrupa msgs ordenadas. Pra cada "entrada" sem resposta
  // anterior do Caio, mede gap até a próxima "saida".
  const porLead: Record<string, MsgAggregate[]> = {};
  mensagens.forEach((m) => {
    if (!porLead[m.lead_id]) porLead[m.lead_id] = [];
    porLead[m.lead_id].push(m);
  });

  const gaps: number[] = [];
  Object.values(porLead).forEach((msgs) => {
    msgs.sort(
      (a, b) =>
        new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    );
    let pendente: number | null = null;
    msgs.forEach((m) => {
      const t = new Date(m.created_at).getTime();
      if (m.direcao === "entrada" && pendente === null) {
        pendente = t;
      } else if (m.direcao === "saida" && pendente !== null) {
        gaps.push((t - pendente) / 1000); // segundos
        pendente = null;
      }
    });
  });

  if (gaps.length === 0) return { valor: 0, unidade: "s" };
  const media = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  if (media < 60) return { valor: Math.round(media), unidade: "s" };
  if (media < 3600) return { valor: Math.round(media / 60), unidade: "min" };
  return { valor: Math.round(media / 3600), unidade: "h" };
}

function MetricCard({
  titulo,
  valor,
  descricao,
  destaque = false,
  sufixo = "",
  delta = null,
}: {
  titulo: string;
  valor: number;
  descricao?: string;
  destaque?: boolean;
  sufixo?: string;
  delta?: number | null;
}) {
  const valorFormatado =
    sufixo === "%" ? valor.toFixed(1) : Math.round(valor).toString();
  return (
    <div
      className={`bg-white rounded-2xl border p-5 ${
        destaque
          ? "border-laranja shadow-sm shadow-laranja/10"
          : "border-cinza-claro"
      }`}
    >
      <p className="text-xs font-heading font-medium text-cinza-medio uppercase tracking-wider">
        {titulo}
      </p>
      <div className="flex items-baseline gap-2 mt-2">
        <p
          className={`text-3xl font-heading font-bold ${
            destaque ? "text-laranja" : "text-preto"
          }`}
        >
          {valorFormatado}
          {sufixo && (
            <span className="text-lg ml-0.5 text-cinza-medio">{sufixo}</span>
          )}
        </p>
        {delta !== null && delta !== undefined && (
          <span
            className={`text-xs font-heading font-semibold ${
              delta >= 0 ? "text-green-700" : "text-red-700"
            }`}
          >
            {delta >= 0 ? "▲" : "▼"} {Math.abs(delta).toFixed(0)}%
          </span>
        )}
      </div>
      {descricao && (
        <p className="text-xs text-cinza-medio mt-2">{descricao}</p>
      )}
    </div>
  );
}

function Card({
  titulo,
  children,
}: {
  titulo: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-2xl border border-cinza-claro p-6">
      <h2 className="text-sm font-heading font-bold text-preto mb-4 uppercase tracking-wider">
        {titulo}
      </h2>
      {children}
    </div>
  );
}

function labelMotivoDesq(motivo: string): string {
  if (motivo === "nao_encaixa") return "Operação pequena / sem fit";
  if (motivo === "trazer_decisor") return "Sem autoridade (pedido decisor)";
  return motivo;
}

function formatRelative(dateStr: string | null): string {
  if (!dateStr) return "—";
  const date = new Date(dateStr);
  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHrs = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffMin < 1) return "agora";
  if (diffMin < 60) return `${diffMin}min`;
  if (diffHrs < 24) return `${diffHrs}h`;
  if (diffDays < 7) return `${diffDays}d`;
  return date.toLocaleDateString("pt-BR");
}
