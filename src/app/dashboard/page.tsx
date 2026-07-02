import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import type { ItemPedido } from "@/lib/caio/extrator-pedido";

/**
 * Dashboard "centro de comando" (contexto Beba Mais — loja que tira pedidos).
 * Prioridade 1: o que precisa de AÇÃO agora (pedidos prontos, handoffs,
 * retiradas do dia). Depois: KPIs do dia e visão da semana.
 * (A antiga home de funil B2B/BANT da Facilita foi substituída.)
 */

type Lead = {
  id: string;
  nome: string | null;
  telefone: string;
  status: string;
  caio_ativo: boolean | null;
  created_at: string;
  updated_at: string;
};

type MsgAggregate = {
  lead_id: string;
  direcao: "entrada" | "saida";
  created_at: string;
};

type PedidoResumo = {
  id: string;
  status: string;
  itens: ItemPedido[];
  modalidade: string | null;
  confirmado_em: string | null;
  created_at: string;
  lead: { id: string; nome: string | null; telefone: string } | { id: string; nome: string | null; telefone: string }[] | null;
};

function um<T>(v: T | T[] | null): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

export default async function DashboardPage() {
  const supabase = await createClient();

  const agora = new Date();
  const hoje0 = new Date(agora);
  hoje0.setHours(0, 0, 0, 0);
  const hoje24 = new Date(agora);
  hoje24.setHours(23, 59, 59, 999);
  const inicio7d = new Date(agora);
  inicio7d.setDate(inicio7d.getDate() - 7);
  const inicio14d = new Date(agora);
  inicio14d.setDate(inicio14d.getDate() - 14);

  const [
    { data: pedidosAbertos },
    { data: pedidos14d },
    { data: precisaHumano },
    { data: retiradasHoje },
    { data: leads },
    { data: msgsRecentes },
  ] = await Promise.all([
    // Pedidos em aberto (fila)
    supabase
      .from("pedidos")
      .select(
        "id, status, itens, modalidade, confirmado_em, created_at, lead:leads(id, nome, telefone)",
      )
      .in("status", ["captando", "pronto_para_equipe", "em_atendimento"])
      .order("confirmado_em", { ascending: true, nullsFirst: false })
      .limit(50),
    // Pedidos criados nos últimos 14 dias (KPIs + gráfico)
    supabase
      .from("pedidos")
      .select("id, status, created_at")
      .gte("created_at", inicio14d.toISOString()),
    // Conversas pedindo humano
    supabase
      .from("leads")
      .select(
        "id, nome, telefone, precisa_humano, precisa_humano_motivo, precisa_resposta_humana, updated_at",
      )
      .or("precisa_humano.eq.true,precisa_resposta_humana.eq.true")
      .order("updated_at", { ascending: false })
      .limit(20),
    // Retiradas agendadas pra HOJE
    supabase
      .from("agendamentos")
      .select("id, data_inicio, status, lead:leads(id, nome, telefone)")
      .eq("status", "agendado")
      .gte("data_inicio", hoje0.toISOString())
      .lte("data_inicio", hoje24.toISOString())
      .order("data_inicio", { ascending: true }),
    // Leads (contagens + atividade recente)
    supabase
      .from("leads")
      .select("id, nome, telefone, status, caio_ativo, created_at, updated_at")
      .eq("origem", "inbound"),
    // Mensagens últimos 14d (hora de pico + tempo de resposta)
    supabase
      .from("mensagens")
      .select("lead_id, direcao, created_at")
      .gte("created_at", inicio14d.toISOString())
      .limit(5000),
  ]);

  const abertos = (pedidosAbertos ?? []) as unknown as PedidoResumo[];
  const prontos = abertos.filter((p) => p.status === "pronto_para_equipe");
  const emAtendimentoCount = abertos.filter((p) => p.status === "em_atendimento").length;
  const captandoCount = abertos.filter((p) => p.status === "captando").length;

  const pendentesHumano = (precisaHumano ?? []) as unknown as {
    id: string;
    nome: string | null;
    telefone: string;
    precisa_humano: boolean | null;
    precisa_humano_motivo: string | null;
    precisa_resposta_humana: boolean | null;
    updated_at: string;
  }[];

  const retiradas = (retiradasHoje ?? []) as unknown as {
    id: string;
    data_inicio: string;
    lead: { id: string; nome: string | null; telefone: string } | { id: string; nome: string | null; telefone: string }[] | null;
  }[];

  // KPIs
  const pedidosHoje =
    pedidos14d?.filter((p) => new Date(p.created_at) >= hoje0).length ?? 0;
  const pedidosSemana =
    pedidos14d?.filter((p) => new Date(p.created_at) >= inicio7d).length ?? 0;
  const pedidosSemanaAnterior =
    (pedidos14d?.length ?? 0) - pedidosSemana;
  const deltaPedidos = pctDelta(pedidosSemana, pedidosSemanaAnterior);
  const emConversa = leads?.filter((l) => l.status === "em_conversa").length ?? 0;
  const tempoResposta = calcularTempoResposta(
    (msgsRecentes ?? []) as MsgAggregate[],
  );

  // Gráfico: pedidos + novos contatos por dia (últimos 7 dias)
  const dias: { label: string; pedidos: number; contatos: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    const d0 = new Date(agora);
    d0.setDate(d0.getDate() - i);
    d0.setHours(0, 0, 0, 0);
    const d1 = new Date(d0);
    d1.setHours(23, 59, 59, 999);
    dias.push({
      label: d0.toLocaleDateString("pt-BR", { weekday: "short" }).replace(".", ""),
      pedidos:
        pedidos14d?.filter((p) => {
          const c = new Date(p.created_at);
          return c >= d0 && c <= d1;
        }).length ?? 0,
      contatos: countNaJanela(leads as Lead[] | null, d0, d1),
    });
  }
  const maxDia = Math.max(1, ...dias.map((d) => Math.max(d.pedidos, d.contatos)));

  // Hora de pico (mensagens de entrada, 14d)
  const porHora = new Array(24).fill(0) as number[];
  (msgsRecentes ?? []).forEach((m) => {
    if (m.direcao !== "entrada") return;
    const h = new Date(m.created_at).getHours();
    porHora[h]++;
  });
  const maxHora = Math.max(1, ...porHora);

  // Atividade recente
  const recentes = [...(leads ?? [])]
    .sort((a, b) => (b.updated_at ?? "").localeCompare(a.updated_at ?? ""))
    .slice(0, 5);

  const totalPendencias =
    prontos.length + pendentesHumano.length + retiradas.length;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-heading font-bold text-preto">
          Visão geral
        </h1>
        <p className="text-sm text-cinza-medio mt-1">
          {totalPendencias === 0
            ? "Tudo em dia — nenhuma pendência agora. 🍻"
            : `${totalPendencias} ${totalPendencias === 1 ? "coisa precisa" : "coisas precisam"} da sua atenção.`}
        </p>
      </div>

      {/* ===== PENDÊNCIAS — o que precisa de ação AGORA ===== */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <PendenciaCard
          titulo="Pedidos prontos pra finalizar"
          count={prontos.length}
          href="/dashboard/pedidos"
          cor="laranja"
        >
          {prontos.slice(0, 4).map((p) => {
            const lead = um(p.lead);
            return (
              <PendenciaItem
                key={p.id}
                href={lead ? `/dashboard/contatos/${lead.id}` : "/dashboard/pedidos"}
                principal={lead?.nome ?? "Sem nome"}
                secundario={resumirItens(p.itens)}
              />
            );
          })}
        </PendenciaCard>

        <PendenciaCard
          titulo="Precisam de você"
          count={pendentesHumano.length}
          href="/dashboard/contatos"
          cor="vermelho"
        >
          {pendentesHumano.slice(0, 4).map((l) => (
            <PendenciaItem
              key={l.id}
              href={`/dashboard/contatos/${l.id}`}
              principal={l.nome ?? l.telefone}
              secundario={
                l.precisa_humano
                  ? labelMotivoHandoff(l.precisa_humano_motivo)
                  : "Mandou mensagem com o Caio desligado"
              }
            />
          ))}
        </PendenciaCard>

        <PendenciaCard
          titulo="Retiradas de hoje"
          count={retiradas.length}
          href="/dashboard/agenda"
          cor="verde"
        >
          {retiradas.slice(0, 4).map((r) => {
            const lead = um(r.lead);
            return (
              <PendenciaItem
                key={r.id}
                href={lead ? `/dashboard/contatos/${lead.id}` : "/dashboard/agenda"}
                principal={lead?.nome ?? lead?.telefone ?? "—"}
                secundario={new Date(r.data_inicio).toLocaleTimeString("pt-BR", {
                  hour: "2-digit",
                  minute: "2-digit",
                  timeZone: "America/Sao_Paulo",
                })}
              />
            );
          })}
        </PendenciaCard>
      </div>

      {/* ===== KPIs do dia / semana ===== */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard titulo="Pedidos hoje" valor={pedidosHoje} destaque />
        <MetricCard
          titulo="Pedidos na semana"
          valor={pedidosSemana}
          delta={deltaPedidos}
          descricao="vs semana anterior"
        />
        <MetricCard
          titulo="Em conversa agora"
          valor={emConversa}
          descricao={`${captandoCount} com pedido sendo anotado · ${emAtendimentoCount} com atendente`}
        />
        <MetricCard
          titulo="Resposta do Caio"
          valor={tempoResposta.valor}
          sufixo={tempoResposta.unidade}
          descricao="tempo médio da 1ª resposta"
        />
      </div>

      {/* ===== Gráficos ===== */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card titulo="Últimos 7 dias — pedidos e novos contatos">
          <div className="flex items-end gap-2 h-36">
            {dias.map((d, i) => (
              <div key={i} className="flex-1 flex flex-col items-center gap-1">
                <div className="w-full flex items-end justify-center gap-1 h-28">
                  <div
                    title={`${d.pedidos} pedidos`}
                    className="w-1/3 bg-laranja rounded-t"
                    style={{ height: `${(d.pedidos / maxDia) * 100}%`, minHeight: d.pedidos > 0 ? 4 : 0 }}
                  />
                  <div
                    title={`${d.contatos} novos contatos`}
                    className="w-1/3 bg-cinza-claro rounded-t"
                    style={{ height: `${(d.contatos / maxDia) * 100}%`, minHeight: d.contatos > 0 ? 4 : 0 }}
                  />
                </div>
                <span className="text-[10px] text-cinza-medio">{d.label}</span>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-4 mt-3 text-[11px] text-cinza-medio">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-laranja inline-block" />
              Pedidos
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-cinza-claro inline-block" />
              Novos contatos
            </span>
          </div>
        </Card>

        <Card titulo="Hora de pico — mensagens recebidas (14d)">
          <div className="flex items-end gap-[2px] h-36">
            {porHora.map((qtd, h) => (
              <div
                key={h}
                className="flex-1 flex flex-col items-center justify-end h-full"
                title={`${h}h — ${qtd} msgs`}
              >
                <div
                  className={`w-full rounded-t ${qtd === maxHora && qtd > 0 ? "bg-laranja" : "bg-cinza-claro"}`}
                  style={{ height: `${(qtd / maxHora) * 100}%`, minHeight: qtd > 0 ? 3 : 0 }}
                />
                {h % 6 === 0 && (
                  <span className="text-[9px] text-cinza-medio mt-1">{h}h</span>
                )}
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* ===== Atividade recente ===== */}
      <Card titulo="Atividade recente">
        {recentes.length === 0 ? (
          <p className="text-sm text-cinza-medio">Nenhum contato ainda.</p>
        ) : (
          <ul className="divide-y divide-cinza-claro/60">
            {recentes.map((l) => (
              <li key={l.id}>
                <Link
                  href={`/dashboard/contatos/${l.id}`}
                  className="flex items-center justify-between gap-3 py-2.5 hover:bg-offwhite -mx-2 px-2 rounded-lg transition"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-heading font-semibold text-preto truncate">
                      {l.nome ?? "Sem nome"}
                    </p>
                    <p className="text-xs text-cinza-medio font-mono">
                      {l.telefone}
                    </p>
                  </div>
                  <span className="text-xs text-cinza-medio shrink-0">
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

// ===== Componentes =====

function PendenciaCard({
  titulo,
  count,
  href,
  cor,
  children,
}: {
  titulo: string;
  count: number;
  href: string;
  cor: "laranja" | "vermelho" | "verde";
  children: React.ReactNode;
}) {
  const cores = {
    laranja: { borda: "border-laranja", badge: "bg-laranja text-white" },
    vermelho: { borda: "border-red-300", badge: "bg-red-600 text-white" },
    verde: { borda: "border-emerald-300", badge: "bg-emerald-600 text-white" },
  }[cor];
  return (
    <div
      className={`bg-white rounded-2xl border p-5 ${count > 0 ? cores.borda : "border-cinza-claro"}`}
    >
      <Link href={href} className="flex items-center justify-between mb-3 group">
        <h2 className="text-sm font-heading font-bold text-preto uppercase tracking-wider group-hover:text-laranja transition">
          {titulo}
        </h2>
        <span
          className={`inline-flex items-center justify-center min-w-7 h-7 px-2 rounded-full text-sm font-heading font-bold ${
            count > 0 ? cores.badge : "bg-offwhite text-cinza-medio"
          }`}
        >
          {count}
        </span>
      </Link>
      {count === 0 ? (
        <p className="text-sm text-cinza-medio">Nada por aqui. ✓</p>
      ) : (
        <div className="space-y-1">{children}</div>
      )}
      {count > 4 && (
        <Link
          href={href}
          className="block mt-2 text-xs text-laranja hover:text-laranja-escuro font-heading font-semibold"
        >
          Ver todos ({count}) →
        </Link>
      )}
    </div>
  );
}

function PendenciaItem({
  href,
  principal,
  secundario,
}: {
  href: string;
  principal: string;
  secundario: string;
}) {
  return (
    <Link
      href={href}
      className="block py-1.5 px-2 -mx-2 rounded-lg hover:bg-offwhite transition"
    >
      <p className="text-sm font-heading font-semibold text-preto truncate">
        {principal}
      </p>
      <p className="text-xs text-cinza-medio truncate">{secundario}</p>
    </Link>
  );
}

function resumirItens(itens: ItemPedido[]): string {
  if (!itens?.length) return "sem itens";
  const partes = itens
    .slice(0, 3)
    .map((i) => `${i.quantidade}${i.unidade ? ` ${i.unidade}` : "x"} ${i.produto}`);
  const resto = itens.length - 3;
  return partes.join(" · ") + (resto > 0 ? ` +${resto}` : "");
}

function labelMotivoHandoff(motivo: string | null): string {
  if (motivo === "muda_reuniao") return "Quer mudar a retirada";
  if (motivo === "irritado") return "Cliente irritado — assumir com carinho";
  if (motivo === "pede_humano") return "Pediu pra falar com uma pessoa";
  return "Caio passou pra você";
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

function calcularTempoResposta(mensagens: MsgAggregate[]): {
  valor: number;
  unidade: string;
} {
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
        gaps.push((t - pendente) / 1000);
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
