import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { EmptyState } from "@/components/empty-state";
import {
  STATUS_CONFIG,
  STATUS_ORDEM,
  type StatusLead,
} from "@/lib/status-config";
import { ContatosTabela, BotaoImportarContatos } from "./tabela";

type FiltroEstado = "ativos" | "encerrados" | "todos";
type FiltroOrigem = "todos" | "inbound" | "prospeccao";
type FiltroAtrib = "todas" | "minhas" | "livres";

type FilterParams = {
  estado?: FiltroEstado;
  origem?: FiltroOrigem;
  atrib?: FiltroAtrib;
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
  const atrib = (params.atrib as FiltroAtrib) ?? "todas";
  // Filtro fino por status — quando ativo, sobrepõe o agrupador Ativos/Encerrados
  // (evita interseção vazia tipo Encerrados + Em conversa).
  const statusFiltro = STATUS_ORDEM.includes(params.status as StatusLead)
    ? (params.status as StatusLead)
    : null;
  const searchQuery = params.q ?? "";
  const page = Math.max(1, parseInt(params.page ?? "1", 10) || 1);
  const offset = (page - 1) * PER_PAGE;

  const supabase = await createClient();

  // Usuário logado — pra filtro "Minhas" e destaque na lista (item 8).
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const meuUserId = user?.id ?? null;

  let query = supabase
    .from("leads")
    .select(
      "id, nome, telefone, status, origem, updated_at, created_at, atribuido_a, atribuido_nome",
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

  // Filtro de atribuição: "minhas" = atribuídas a mim, "livres" = não atribuídas
  if (atrib === "minhas" && meuUserId) query = query.eq("atribuido_a", meuUserId);
  else if (atrib === "livres") query = query.is("atribuido_a", null);

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
      supabase.from("leads").select("status, origem, atribuido_a"),
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
    minhas:
      contagensRaw?.filter((l) => meuUserId && l.atribuido_a === meuUserId)
        .length ?? 0,
    livres: contagensRaw?.filter((l) => !l.atribuido_a).length ?? 0,
  };

  const contagemPorStatus: Partial<Record<StatusLead, number>> = {};
  for (const l of contagensRaw ?? []) {
    const s = l.status as StatusLead;
    contagemPorStatus[s] = (contagemPorStatus[s] ?? 0) + 1;
  }

  const totalPages = Math.max(1, Math.ceil((count ?? 0) / PER_PAGE));

  const statusVisiveis = STATUS_ORDEM.filter(
    (s) => (contagemPorStatus[s] ?? 0) > 0 || statusFiltro === s,
  );

  function buildHref(opts: Partial<FilterParams>): string {
    const sp = new URLSearchParams();
    const e = opts.estado ?? estado;
    const o = opts.origem ?? origem;
    const at = opts.atrib ?? atrib;
    const st = opts.status ?? statusFiltro ?? "";
    const qq = opts.q ?? searchQuery;
    const pg = opts.page ?? "1";
    if (e !== "ativos") sp.set("estado", e);
    if (o !== "todos") sp.set("origem", o);
    if (at !== "todas") sp.set("atrib", at);
    if (st) sp.set("status", st);
    if (qq) sp.set("q", qq);
    if (pg !== "1") sp.set("page", pg);
    const qs = sp.toString();
    return qs ? `/dashboard/contatos?${qs}` : "/dashboard/contatos";
  }

  return (
    <div>
      {/* Header compacto: título + busca + importar numa linha só */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <div className="flex items-baseline gap-3">
          <h1 className="text-2xl font-heading font-bold text-preto">
            Conversas
          </h1>
          <span className="text-sm text-cinza-medio">
            {contagens.todos} no total
          </span>
        </div>
        <div className="flex items-center gap-2">
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
            {atrib !== "todas" && (
              <input type="hidden" name="atrib" value={atrib} />
            )}
            <input
              type="text"
              name="q"
              defaultValue={searchQuery}
              placeholder="Buscar nome ou telefone..."
              className="px-3 py-2 w-64 border border-cinza-claro rounded-lg text-sm text-preto placeholder:text-cinza-medio focus:outline-none focus:border-laranja focus:ring-2 focus:ring-laranja/20 transition"
            />
          </form>
          <BotaoImportarContatos />
        </div>
      </div>

      {/* Filtros: agrupadores Ativos/Encerrados + filtro fino por status */}
      <div className="flex flex-wrap items-center gap-1.5 mb-3">
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
        {/* Só mostra status com gente (chip zerado é ruído); o ativo fica
            visível mesmo zerado pra dar como desligar o filtro. */}
        {statusVisiveis.length > 0 && (
          <span className="text-cinza-claro mx-1">|</span>
        )}
        {statusVisiveis.map((s) => (
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

        {/* Atribuição (item 8): Minhas / Não atribuídas / Todas — cada
            atendente foca nas suas conversas e nas que estão livres. */}
        <span className="text-cinza-claro mx-1">|</span>
        <FilterChip
          label="Todas"
          count={contagens.todos}
          active={atrib === "todas"}
          href={buildHref({ atrib: "todas" })}
        />
        <FilterChip
          label="Minhas"
          count={contagens.minhas}
          active={atrib === "minhas"}
          href={buildHref({ atrib: "minhas" })}
        />
        <FilterChip
          label="Não atribuídas"
          count={contagens.livres}
          active={atrib === "livres"}
          href={buildHref({ atrib: "livres" })}
        />
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
            meuUserId={meuUserId}
            leads={leads.map((l) => ({
              id: l.id,
              nome: l.nome,
              telefone: l.telefone,
              status: l.status,
              origem: l.origem ?? "inbound",
              updated_at: l.updated_at,
              created_at: l.created_at,
              atribuido_a: l.atribuido_a ?? null,
              atribuido_nome: l.atribuido_nome ?? null,
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
      className={`inline-flex items-center gap-1.5 rounded-full font-heading font-medium transition whitespace-nowrap px-2.5 py-1 text-xs ${
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
