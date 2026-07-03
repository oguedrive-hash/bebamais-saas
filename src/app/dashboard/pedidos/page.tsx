import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { PedidoCard, type PedidoRow } from "@/components/pedido-card";

type LeadRef = { id: string; nome: string | null; telefone: string } | null;
type AgRef = { id: string; data_inicio: string; status: string } | null;

type PedidoComLead = PedidoRow & {
  lead: LeadRef | LeadRef[];
  agendamento: AgRef | AgRef[];
};

function um<T>(v: T | T[] | null): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

export default async function PedidosPage({
  searchParams,
}: {
  searchParams: Promise<{ ver?: string }>;
}) {
  const params = await searchParams;
  const verEncerrados = params.ver === "encerrados";
  const supabase = await createClient();

  const { data } = await supabase
    .from("pedidos")
    .select(
      `id, status, itens, modalidade, endereco, nome_cliente, obs,
       confirmado_em, created_at, updated_at,
       lead:leads(id, nome, telefone),
       agendamento:agendamentos(id, data_inicio, status)`,
    )
    .in(
      "status",
      verEncerrados
        ? ["finalizado", "cancelado"]
        : ["pronto_para_equipe", "em_atendimento", "captando"],
    )
    .order("updated_at", { ascending: false })
    .limit(100);

  const pedidos = (data ?? []) as unknown as PedidoComLead[];

  const prontos = pedidos
    .filter((p) => p.status === "pronto_para_equipe")
    // FIFO: quem confirmou primeiro aparece primeiro
    .sort((a, b) => (a.confirmado_em ?? "").localeCompare(b.confirmado_em ?? ""));
  const emAtendimento = pedidos.filter((p) => p.status === "em_atendimento");
  const captando = pedidos.filter((p) => p.status === "captando");
  const encerrados = pedidos.filter(
    (p) => p.status === "finalizado" || p.status === "cancelado",
  );

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-4">
        <PageHeader
          titulo="Pedidos"
          descricao="O que a IA anotou nas conversas — a equipe finaliza valores e pagamento"
        />
        <div className="inline-flex rounded-lg border border-cinza-claro overflow-hidden">
          <Link
            href="/dashboard/pedidos"
            className={`px-3 py-2 text-sm font-heading font-semibold transition border-r border-cinza-claro ${
              !verEncerrados
                ? "bg-preto text-white"
                : "bg-white text-cinza-medio hover:text-preto"
            }`}
          >
            Abertos
          </Link>
          <Link
            href="/dashboard/pedidos?ver=encerrados"
            className={`px-3 py-2 text-sm font-heading font-semibold transition ${
              verEncerrados
                ? "bg-preto text-white"
                : "bg-white text-cinza-medio hover:text-preto"
            }`}
          >
            Encerrados
          </Link>
        </div>
      </div>

      {!verEncerrados ? (
        pedidos.length === 0 ? (
          <EmptyState
            icone="🛒"
            titulo="Nenhum pedido em aberto"
            descricao="Quando a IA anotar um pedido numa conversa, ele aparece aqui."
          />
        ) : (
          <div className="space-y-5">
            <Secao
              titulo={`Prontos pra finalizar (${prontos.length})`}
              destaque
              vazio="Nenhum pedido aguardando a equipe."
            >
              {prontos.map((p) => (
                <PedidoItem key={p.id} pedido={p} />
              ))}
            </Secao>

            <Secao
              titulo={`Com o atendente (${emAtendimento.length})`}
              vazio="Nenhum pedido assumido no momento."
            >
              {emAtendimento.map((p) => (
                <PedidoItem key={p.id} pedido={p} />
              ))}
            </Secao>

            <Secao
              titulo={`IA ainda anotando (${captando.length})`}
              vazio="Nenhuma captação em andamento."
            >
              {captando.map((p) => (
                <PedidoItem key={p.id} pedido={p} />
              ))}
            </Secao>
          </div>
        )
      ) : encerrados.length === 0 ? (
        <EmptyState
          icone="📦"
          titulo="Nenhum pedido encerrado ainda"
          descricao="Pedidos finalizados ou cancelados aparecem aqui."
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {encerrados.map((p) => (
            <PedidoItem key={p.id} pedido={p} compacto />
          ))}
        </div>
      )}
    </div>
  );
}

function Secao({
  titulo,
  destaque = false,
  vazio,
  children,
}: {
  titulo: string;
  destaque?: boolean;
  vazio: string;
  children: React.ReactNode[];
}) {
  return (
    <section>
      <h2
        className={`text-lg font-heading font-bold mb-3 ${
          destaque ? "text-laranja-escuro" : "text-preto"
        }`}
      >
        {titulo}
      </h2>
      {children.length === 0 ? (
        <p className="text-sm text-cinza-medio">{vazio}</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {children}
        </div>
      )}
    </section>
  );
}

function PedidoItem({
  pedido,
  compacto = false,
}: {
  pedido: PedidoComLead;
  compacto?: boolean;
}) {
  const lead = um(pedido.lead);
  const ag = um(pedido.agendamento);
  return (
    <div>
      <div className="flex items-center justify-between px-1 mb-1.5">
        <p className="text-sm font-heading font-semibold text-preto truncate">
          {lead?.nome ?? pedido.nome_cliente ?? "Sem nome"}
          <span className="ml-2 text-xs font-body font-normal text-cinza-medio font-mono">
            {lead?.telefone}
          </span>
        </p>
        {ag && ag.status === "agendado" && (
          <span className="text-[11px] text-cinza-medio shrink-0">
            🕐{" "}
            {new Date(ag.data_inicio).toLocaleString("pt-BR", {
              weekday: "short",
              day: "2-digit",
              month: "2-digit",
              hour: "2-digit",
              minute: "2-digit",
              timeZone: "America/Sao_Paulo",
            })}
          </span>
        )}
      </div>
      <PedidoCard
        pedido={pedido}
        compacto={compacto}
        linkConversa={lead ? `/dashboard/contatos/${lead.id}` : undefined}
      />
    </div>
  );
}
