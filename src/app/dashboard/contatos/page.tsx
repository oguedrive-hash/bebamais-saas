import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { EmptyState } from "@/components/empty-state";
import {
  STATUS_CONFIG,
  STATUS_ORDEM,
  type StatusLead,
} from "@/lib/status-config";
import { ContatosTabela } from "./tabela";

type FiltroEstado = "ativos" | "encerrados" | "todos";
type FiltroOrigem = "todos" | "inbound" | "prospeccao";

type FilterParams = {
  estado?: FiltroEstado;
  origem?: FiltroOrigem;
  status?: string;
  q?: string;
  page?: string;
};

const PER_PAGE = 50;
const STATUS_ATIVOS = [
  "novo_lead",
  "em_conversa",
  "followup",
  "contatar_futuramente",
  "reuniao_agendada",
  "aguardando_primeiro_contato",
  "em_prospeccao",
];
const STATUS_ENCERRADOS = ["perdido", "fechou"];

export default async function ContatosPage({
  searchParams,
}: {
  searchParams: Promise<FilterParams>;
}) {
  const params = await searchParams;
  const estado = (params.estado as FiltroEstado) ?? "ativos";
  const origem = (params.origem as FiltroOrigem) ?? "todos";
  // Filtro fino por status — quando ativo, sobrepõe o agrupador Ativos/Encerrados
  // (evita interseção vazia tipo Encerrados + Em conversa).
  const statusFiltro = STATUS_ORDEM.includes(params.status as StatusLead)
    ? (params.status as StatusLead)
    : null;
  const searchQuery = params.q ?? "";
  const page = Math.max(1, parseInt(params.page ?? "1", 10) || 1);
  const offset = (page - 1) * PER_PAGE;

  const supabase = await createClient();

  let query = supabase
    .from("leads")
    .select(
      "id, nome, telefone, status, origem, updated_at, created_at",
      { count: "exact" },
    );

  // Filtro de status específico > filtro de estado (ativo/encerrado/todos)
  if (statusFiltro) query = query.eq("status", statusFiltro);
  else if (estado === "ativos") query = query.in("status", STATUS_ATIVOS);
  else if (estado === "encerrados")
    query = query.in("status", STATUS_ENCERRADOS);

  // Filtro de origem
  if (origem === "inbound") query = query.eq("origem", "inbound");
  else if (origem === "prospeccao") query = query.eq("origem", "prospeccao");

  // Busca por nome/telefone
  if (searchQuery.trim()) {
    const q = searchQuery.trim().replace(/[%_]/g, "");
    query = query.or(`nome.ilike.%${q}%,telefone.ilike.%${q}%`);
  }

  const [{ data: leads, error, count }, { data: contagensRaw }] =
    await Promise.all([
      query
        .order("updated_at", { ascending: false })
        .range(offset, offset + PER_PAGE - 1),
      supabase.from("leads").select("status, origem"),
    ]);

  const contagens = {
    ativos:
      contagensRaw?.filter((l) => STATUS_ATIVOS.includes(l.status)).length ?? 0,
    encerrados:
      contagensRaw?.filter((l) => STATUS_ENCERRADOS.includes(l.status))
        .length ?? 0,
    todos: contagensRaw?.length ?? 0,
    inbound: contagensRaw?.filter((l) => l.origem === "inbound").length ?? 0,
    prospeccao:
      contagensRaw?.filter((l) => l.origem === "prospeccao").length ?? 0,
  };

  const contagemPorStatus: Partial<Record<StatusLead, number>> = {};
  for (const l of contagensRaw ?? []) {
    const s = l.status as StatusLead;
    contagemPorStatus[s] = (contagemPorStatus[s] ?? 0) + 1;
  }

  const totalPages = Math.max(1, Math.ceil((count ?? 0) / PER_PAGE));

  function buildHref(opts: Partial<FilterParams>): string {
    const sp = new URLSearchParams();
    const e = opts.estado ?? estado;
    const o = opts.origem ?? origem;
    const st = opts.status ?? statusFiltro ?? "";
    const qq = opts.q ?? searchQuery;
    const pg = opts.page ?? "1";
    if (e !== "ativos") sp.set("estado", e);
    if (o !== "todos") sp.set("origem", o);
    if (st) sp.set("status", st);
    if (qq) sp.set("q", qq);
    if (pg !== "1") sp.set("page", pg);
    const qs = sp.toString();
    return qs ? `/dashboard/contatos?${qs}` : "/dashboard/contatos";
  }

  return (
    <div>
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-baseline gap-3">
          <h1 className="text-4xl font-heading font-bold text-preto">
            Conversas
          </h1>
          <span className="text-sm text-cinza-medio">
            {contagens.todos} no total
          </span>
        </div>
        <form
          method="get"
          action="/dashboard/contatos"
          className="flex items-center gap-1.5"
        >
          {estado !== "ativos" && (
            <input type="hidden" name="estado" value={estado} />
          )}
          {origem !== "todos" && (
            <input type="hidden" name="origem" value={origem} />
          )}
          {statusFiltro && (
            <input type="hidden" name="status" value={statusFiltro} />
          )}
          <input
            type="text"
            name="q"
            defaultValue={searchQuery}
            placeholder="Buscar nome ou telefone..."
            className="px-3 py-2.5 w-80 border border-cinza-claro rounded-lg text-sm text-preto placeholder:text-cinza-medio focus:outline-none focus:border-laranja focus:ring-2 focus:ring-laranja/20 transition"
          />
        </form>
      </div>

      {/* Filtros: agrupadores Ativos/Encerrados + filtro fino por status */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <FilterChip
          label="Ativos"
          count={contagens.ativos}
          active={!statusFiltro && estado === "ativos"}
          href={buildHref({ estado: "ativos", status: "" })}
        />
        <FilterChip
          label="Encerrados"
          count={contagens.encerrados}
          active={!statusFiltro && estado === "encerrados"}
          href={buildHref({ estado: "encerrados", status: "" })}
        />
        <FilterChip
          label="Todos"
          count={contagens.todos}
          active={!statusFiltro && estado === "todos"}
          href={buildHref({ estado: "todos", status: "" })}
        />
        <span className="text-cinza-claro mx-2">|</span>
        {STATUS_ORDEM.map((s) => (
          <FilterChip
            key={s}
            label={STATUS_CONFIG[s].label}
            count={contagemPorStatus[s] ?? 0}
            active={statusFiltro === s}
            href={buildHref({ status: statusFiltro === s ? "" : s })}
          />
        ))}
        {/* Chips de origem (Inbound/Prospecção) escondidos — prospecção
            desligada por enquanto. O filtro ?origem= continua funcionando
            por URL se precisar. */}
      </div>

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg mb-6">
          <p className="text-sm text-red-800">
            Erro ao carregar contatos: {error.message}
          </p>
        </div>
      )}

      {!leads || leads.length === 0 ? (
        <EmptyState
          icone="👥"
          titulo="Nenhuma conversa encontrada"
          descricao={
            !searchQuery && !statusFiltro && estado === "ativos" && origem === "todos"
              ? "Importe contatos pra começar — botão '+ Importar contatos' acima."
              : "Nenhuma conversa com os filtros atuais."
          }
        />
      ) : (
        <>
          <ContatosTabela
            leads={leads.map((l) => ({
              id: l.id,
              nome: l.nome,
              telefone: l.telefone,
              status: l.status,
              origem: l.origem ?? "inbound",
              updated_at: l.updated_at,
              created_at: l.created_at,
            }))}
          />
          <Paginator
            page={page}
            totalPages={totalPages}
            total={count ?? 0}
            offset={offset}
            shownInPage={leads.length}
            buildHref={buildHref}
          />
        </>
      )}
    </div>
  );
}

function FilterChip({
  label,
  count,
  active,
  href,
}: {
  label: string;
  count?: number;
  active: boolean;
  href: string;
}) {
  return (
    <Link
      href={href}
      className={`inline-flex items-center gap-2 rounded-full font-heading font-medium transition whitespace-nowrap px-3 py-1.5 text-sm ${
        active
          ? "bg-preto text-white"
          : "bg-white text-cinza-medio border border-cinza-claro hover:border-laranja hover:text-preto"
      }`}
    >
      <span>{label}</span>
      {count !== undefined && (
        <span
          className={`text-[10px] px-1.5 py-0.5 rounded-full ${
            active ? "bg-white/20" : "bg-cinza-claro"
          }`}
        >
          {count}
        </span>
      )}
    </Link>
  );
}

function Paginator({
  page,
  totalPages,
  total,
  offset,
  shownInPage,
  buildHref,
}: {
  page: number;
  totalPages: number;
  total: number;
  offset: number;
  shownInPage: number;
  buildHref: (opts: Partial<FilterParams>) => string;
}) {
  if (total === 0) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 mt-4 px-2">
      <p className="text-xs text-cinza-medio">
        Mostrando <strong className="text-preto">{offset + 1}</strong> a{" "}
        <strong className="text-preto">{offset + shownInPage}</strong> de{" "}
        <strong className="text-preto">{total}</strong>
      </p>
      <div className="flex items-center gap-1">
        {page > 1 ? (
          <Link
            href={buildHref({ page: String(page - 1) })}
            className="px-3 py-1.5 text-xs rounded-lg bg-white border border-cinza-claro hover:border-laranja hover:text-laranja transition"
          >
            ‹ Anterior
          </Link>
        ) : (
          <span className="px-3 py-1.5 text-xs text-cinza-medio rounded-lg bg-offwhite border border-cinza-claro opacity-50">
            ‹ Anterior
          </span>
        )}
        <span className="px-3 text-xs text-cinza-medio">
          Página {page} de {totalPages}
        </span>
        {page < totalPages ? (
          <Link
            href={buildHref({ page: String(page + 1) })}
            className="px-3 py-1.5 text-xs rounded-lg bg-white border border-cinza-claro hover:border-laranja hover:text-laranja transition"
          >
            Próxima ›
          </Link>
        ) : (
          <span className="px-3 py-1.5 text-xs text-cinza-medio rounded-lg bg-offwhite border border-cinza-claro opacity-50">
            Próxima ›
          </span>
        )}
      </div>
    </div>
  );
}
