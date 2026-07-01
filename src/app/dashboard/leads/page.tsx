import Link from "next/link";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { StatusSelector } from "@/components/status-selector";
import { EmptyState } from "@/components/empty-state";
import { PeriodoDropdown } from "@/components/periodo-dropdown";
import { KanbanDrag } from "@/components/kanban-drag";
import { SalvarViewPadrao } from "@/components/salvar-view-padrao";
import { STATUS_CONFIG, STATUS_ORDEM, type StatusLead } from "@/lib/status-config";
import {
  CheckboxLeadLote,
  CheckboxTodosLote,
  SelecaoLoteProvider,
  ToolbarLoteLeads,
} from "./selecao-lote";

type CaioFilter = "todos" | "on" | "off";
type Periodo = "todos" | "hoje" | "7d" | "30d";
type SortField = "updated_at" | "created_at" | "nome" | "status";
type SortOrder = "asc" | "desc";
type View = "lista" | "kanban";

type FilterParams = {
  status?: StatusLead | "todos";
  caio?: CaioFilter;
  q?: string;
  periodo?: Periodo;
  de?: string;
  ate?: string;
  sort?: SortField;
  order?: SortOrder;
  page?: string;
  view?: View;
  precisa_humano?: string;
};

const PER_PAGE = 25;

function calcularDesde(periodo: Periodo): string | null {
  const agora = new Date();
  if (periodo === "hoje") {
    agora.setHours(0, 0, 0, 0);
    return agora.toISOString();
  }
  if (periodo === "7d") {
    agora.setDate(agora.getDate() - 7);
    return agora.toISOString();
  }
  if (periodo === "30d") {
    agora.setDate(agora.getDate() - 30);
    return agora.toISOString();
  }
  return null;
}

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<FilterParams>;
}) {
  const params = await searchParams;
  const statusFilter = params.status ?? "todos";
  const caioFilter = params.caio ?? "todos";
  const searchQuery = params.q ?? "";
  const periodo = params.periodo ?? "todos";
  const de = params.de ?? "";
  const ate = params.ate ?? "";
  const sortField = params.sort ?? "updated_at";
  const sortOrder = params.order ?? "desc";
  const page = Math.max(1, parseInt(params.page ?? "1", 10) || 1);
  const offset = (page - 1) * PER_PAGE;
  const precisaHumanoFilter = params.precisa_humano === "1";
  // View: usa o ?view= da URL se passou, senao cookie de preferencia, senao lista
  const cookieStore = await cookies();
  const viewPreferida = cookieStore.get("lead_view_preferida")?.value;
  const view: View =
    params.view === "kanban" || params.view === "lista"
      ? params.view
      : viewPreferida === "kanban"
        ? "kanban"
        : "lista";

  const supabase = await createClient();

  let query = supabase
    .from("leads")
    .select(
      "id, nome, telefone, status, source, caio_ativo, precisa_humano, precisa_humano_motivo, created_at, updated_at",
      { count: "exact" },
    )
    .eq("origem", "inbound");

  if (view === "kanban") {
    // Kanban: ordenacao fixa por ultima atividade, sem paginacao (mostra todos)
    query = query.order("updated_at", { ascending: false }).limit(500);
  } else {
    query = query
      .order(sortField, { ascending: sortOrder === "asc" })
      .range(offset, offset + PER_PAGE - 1);
    // Status filter so na lista — no kanban as colunas ja sao por status
    if (statusFilter !== "todos") {
      query = query.eq("status", statusFilter);
    }
  }
  if (caioFilter === "on") query = query.eq("caio_ativo", true);
  if (caioFilter === "off") query = query.eq("caio_ativo", false);
  if (precisaHumanoFilter) query = query.eq("precisa_humano", true);
  if (searchQuery.trim()) {
    const q = searchQuery.trim().replace(/[%_]/g, "");
    query = query.or(`nome.ilike.%${q}%,telefone.ilike.%${q}%`);
  }
  // Data customizada tem prioridade sobre chip de periodo
  if (de) {
    query = query.gte("created_at", new Date(de).toISOString());
  } else {
    const desde = calcularDesde(periodo);
    if (desde) query = query.gte("created_at", desde);
  }
  if (ate) {
    // Inclui o dia inteiro do "ate" (até 23:59:59.999)
    const ateData = new Date(ate);
    ateData.setHours(23, 59, 59, 999);
    query = query.lte("created_at", ateData.toISOString());
  }

  // Paraleliza lista + contagens globais (pros chips de filtro)
  const [{ data: leads, error, count: totalLeads }, { data: contagensRaw }] =
    await Promise.all([
      query,
      supabase
        .from("leads")
        .select("status, caio_ativo")
        .eq("origem", "inbound"),
    ]);

  const contagens: Record<string, number> = {
    todos: contagensRaw?.length ?? 0,
    caio_on: 0,
    caio_off: 0,
  };
  contagensRaw?.forEach((l) => {
    contagens[l.status] = (contagens[l.status] ?? 0) + 1;
    if (l.caio_ativo) contagens.caio_on++;
    else contagens.caio_off++;
  });

  const totalPages = Math.max(1, Math.ceil((totalLeads ?? 0) / PER_PAGE));

  function buildHref(opts: Partial<FilterParams>): string {
    const sp = new URLSearchParams();
    const s = opts.status ?? statusFilter;
    const c = opts.caio ?? caioFilter;
    const qq = opts.q ?? searchQuery;
    const p = opts.periodo ?? periodo;
    // Se selecionou chip de periodo, limpa as datas custom (e vice-versa)
    const usandoChip = opts.periodo !== undefined;
    const usandoCustom = opts.de !== undefined || opts.ate !== undefined;
    const d = usandoChip ? "" : (opts.de ?? de);
    const a = usandoChip ? "" : (opts.ate ?? ate);
    const pEffective = usandoCustom ? "todos" : p;
    const sf = opts.sort ?? sortField;
    const so = opts.order ?? sortOrder;
    // Quando muda filtro, volta pra page 1
    const pg = opts.page ?? "1";
    if (s !== "todos") sp.set("status", s);
    // caio=todos sempre setado se passou explicitamente — garante que Next
    // veja mudanca de searchParam quando desativa filtro ativo (sem isso o
    // Router Cache pode reutilizar render anterior).
    if (opts.caio !== undefined) {
      sp.set("caio", c);
    } else if (c !== "todos") {
      sp.set("caio", c);
    }
    if (qq) sp.set("q", qq);
    if (pEffective !== "todos") sp.set("periodo", pEffective);
    if (d) sp.set("de", d);
    if (a) sp.set("ate", a);
    if (sf !== "updated_at") sp.set("sort", sf);
    if (so !== "desc") sp.set("order", so);
    if (pg !== "1") sp.set("page", pg);
    // Se view foi passada explicitamente, sempre seta na URL pra sobrescrever
    // o cookie de preferencia. Sem isso, clicar em "Lista" estando no Kanban
    // (com cookie salvo) navegaria pra URL vazia e o cookie traria de volta.
    if (opts.view !== undefined) {
      sp.set("view", opts.view);
    } else if (view !== "lista") {
      sp.set("view", view);
    }
    const qs = sp.toString();
    return qs ? `/dashboard/leads?${qs}` : "/dashboard/leads";
  }

  function buildExportHref(): string {
    const sp = new URLSearchParams();
    if (statusFilter !== "todos") sp.set("status", statusFilter);
    if (caioFilter !== "todos") sp.set("caio", caioFilter);
    if (searchQuery) sp.set("q", searchQuery);
    if (periodo !== "todos") sp.set("periodo", periodo);
    if (de) sp.set("de", de);
    if (ate) sp.set("ate", ate);
    if (sortField !== "updated_at") sp.set("sort", sortField);
    if (sortOrder !== "desc") sp.set("order", sortOrder);
    const qs = sp.toString();
    return qs ? `/api/leads/export?${qs}` : "/api/leads/export";
  }

  return (
    <div>
      {/* Header compacto: titulo + busca + export em uma linha */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-baseline gap-3">
          <h1 className="text-4xl font-heading font-bold text-preto">Inbound</h1>
          <span className="text-sm text-cinza-medio">
            {contagens.todos} no total
          </span>
        </div>
        <div className="flex items-center gap-2">
          <form
            method="get"
            action="/dashboard/leads"
            className="flex items-center gap-1.5"
          >
            {statusFilter !== "todos" && (
              <input type="hidden" name="status" value={statusFilter} />
            )}
            {caioFilter !== "todos" && (
              <input type="hidden" name="caio" value={caioFilter} />
            )}
            {periodo !== "todos" && (
              <input type="hidden" name="periodo" value={periodo} />
            )}
            {de && <input type="hidden" name="de" value={de} />}
            {ate && <input type="hidden" name="ate" value={ate} />}
            <div className="relative">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="w-4 h-4 text-cinza-medio absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
              >
                <circle cx="11" cy="11" r="8" />
                <path d="m21 21-4.3-4.3" />
              </svg>
              <input
                type="text"
                name="q"
                defaultValue={searchQuery}
                placeholder="Buscar nome ou telefone..."
                className="pl-9 pr-9 py-2.5 w-80 border border-cinza-claro rounded-lg text-sm text-preto placeholder:text-cinza-medio focus:outline-none focus:border-laranja focus:ring-2 focus:ring-laranja/20 transition"
              />
              {searchQuery && (
                <Link
                  href={buildHref({ q: "" })}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-cinza-medio hover:text-preto transition text-sm"
                  title="Limpar busca"
                >
                  ✕
                </Link>
              )}
            </div>
            <button
              type="submit"
              className="sr-only"
              aria-label="Buscar"
            />
            {/* Enter no input ja submete; botao escondido pra acessibilidade */}
          </form>
          {/* Caio on/off toggle group */}
          <div className="inline-flex rounded-lg overflow-hidden">
            <Link
              href={buildHref({
                caio: caioFilter === "on" ? "todos" : "on",
              })}
              className={`px-4 py-2.5 text-sm font-heading font-semibold transition ${
                caioFilter === "on"
                  ? "bg-green-200 text-green-800"
                  : "bg-green-100 text-green-700 hover:bg-green-200"
              }`}
              title="Filtrar leads com Caio respondendo"
            >
              {contagens.caio_on}
            </Link>
            <Link
              href={buildHref({
                caio: caioFilter === "off" ? "todos" : "off",
              })}
              className={`px-4 py-2.5 text-sm font-heading font-semibold transition ${
                caioFilter === "off"
                  ? "bg-red-200 text-red-800"
                  : "bg-red-100 text-red-700 hover:bg-red-200"
              }`}
              title="Filtrar leads com Caio desligado"
            >
              {contagens.caio_off}
            </Link>
          </div>
          {/* Toggle Lista / Kanban */}
          <div className="inline-flex rounded-lg border border-cinza-claro overflow-hidden">
            <Link
              href={buildHref({ view: "lista" })}
              className={`px-3 py-2.5 text-sm font-heading font-semibold transition border-r border-cinza-claro flex items-center gap-1.5 ${
                view === "lista"
                  ? "bg-preto text-white"
                  : "bg-white text-cinza-medio hover:text-preto"
              }`}
              title="Visualização em lista"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="w-4 h-4"
              >
                <line x1="8" x2="21" y1="6" y2="6" />
                <line x1="8" x2="21" y1="12" y2="12" />
                <line x1="8" x2="21" y1="18" y2="18" />
                <line x1="3" x2="3.01" y1="6" y2="6" />
                <line x1="3" x2="3.01" y1="12" y2="12" />
                <line x1="3" x2="3.01" y1="18" y2="18" />
              </svg>
              Lista
            </Link>
            <Link
              href={buildHref({ view: "kanban" })}
              className={`px-3 py-2.5 text-sm font-heading font-semibold transition flex items-center gap-1.5 ${
                view === "kanban"
                  ? "bg-preto text-white"
                  : "bg-white text-cinza-medio hover:text-preto"
              }`}
              title="Visualização em kanban"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="w-4 h-4"
              >
                <rect width="6" height="14" x="3" y="5" rx="1" />
                <rect width="6" height="10" x="15" y="5" rx="1" />
                <rect width="6" height="6" x="9" y="5" rx="1" />
              </svg>
              Kanban
            </Link>
          </div>
          <SalvarViewPadrao
            viewAtual={view}
            viewSalva={
              viewPreferida === "kanban" || viewPreferida === "lista"
                ? viewPreferida
                : null
            }
          />
          <PeriodoDropdown
            periodo={periodo}
            de={de}
            ate={ate}
            presets={{
              todos: buildHref({ periodo: "todos" }),
              hoje: buildHref({ periodo: "hoje" }),
              "7d": buildHref({ periodo: "7d" }),
              "30d": buildHref({ periodo: "30d" }),
            }}
            hrefLimpar={buildHref({ de: "", ate: "" })}
            hiddenInputs={[
              ...(statusFilter !== "todos"
                ? [{ name: "status", value: statusFilter }]
                : []),
              ...(caioFilter !== "todos"
                ? [{ name: "caio", value: caioFilter }]
                : []),
              ...(searchQuery ? [{ name: "q", value: searchQuery }] : []),
            ]}
          />
          <a
            href={buildExportHref()}
            className="inline-flex items-center px-3 py-2.5 rounded-lg bg-white border border-cinza-claro hover:border-laranja text-preto font-heading font-semibold text-sm transition"
          >
            ⬇ CSV
          </a>
        </div>
      </div>

      {/* Status — só na view lista (no kanban as colunas já são por status) */}
      {view === "lista" && (
        <div className="flex items-stretch gap-2 mb-4">
          <FilterChip
            label="Todos"
            count={contagens.todos}
            active={statusFilter === "todos"}
            href={buildHref({ status: "todos" })}
          />
          {STATUS_ORDEM.map((status) => (
            <FilterChip
              key={status}
              label={STATUS_CONFIG[status].label}
              count={contagens[status] ?? 0}
              active={statusFilter === status}
              href={buildHref({ status })}
            />
          ))}
        </div>
      )}

      {/* margem extra antes da tabela */}
      <div className="mb-3" />

      {/* Erro */}
      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg mb-6">
          <p className="text-sm text-red-800">
            Erro ao carregar leads: {error.message}
          </p>
        </div>
      )}

      {/* Lista vazia */}
      {!leads || leads.length === 0 ? (
        <EmptyState
          icone="📭"
          titulo="Nenhum lead encontrado"
          descricao={
            statusFilter === "todos" &&
            caioFilter === "todos" &&
            periodo === "todos"
              ? "Quando alguém mandar mensagem no WhatsApp, vai aparecer aqui automaticamente."
              : "Nenhum lead com os filtros atuais."
          }
        />
      ) : view === "kanban" ? (
        <KanbanDrag leads={leads} />
      ) : (
        <SelecaoLoteProvider>
          <ToolbarLoteLeads />
          <div className="bg-white rounded-2xl border border-cinza-claro">
            <table className="w-full">
              <thead className="bg-offwhite border-b border-cinza-claro">
                <tr>
                  <th className="w-10 px-4 py-3">
                    <CheckboxTodosLote ids={leads.map((l) => l.id)} />
                  </th>
                  <SortableTh
                    label="Nome / Telefone"
                    field="nome"
                    sortField={sortField}
                    sortOrder={sortOrder}
                    buildHref={buildHref}
                  />
                  <SortableTh
                    label="Status"
                    field="status"
                    sortField={sortField}
                    sortOrder={sortOrder}
                    buildHref={buildHref}
                  />
                  <Th>Origem</Th>
                  <SortableTh
                    label="Última atividade"
                    field="updated_at"
                    sortField={sortField}
                    sortOrder={sortOrder}
                    buildHref={buildHref}
                  />
                  <SortableTh
                    label="Criado em"
                    field="created_at"
                    sortField={sortField}
                    sortOrder={sortOrder}
                    buildHref={buildHref}
                  />
                  <Th className="text-right">Ações</Th>
                </tr>
              </thead>
              <tbody>
                {leads.map((lead) => (
                  <tr
                    key={lead.id}
                    className="border-b border-cinza-claro last:border-0 hover:bg-offwhite/50 transition"
                  >
                    <td className="w-10 px-4 py-4">
                      <CheckboxLeadLote leadId={lead.id} />
                    </td>
                    <Td>
                      <div>
                        <p className="font-heading font-semibold text-preto">
                          {lead.nome ?? "Sem nome"}
                        </p>
                        <p className="text-xs text-cinza-medio font-mono mt-0.5">
                          {lead.telefone}
                        </p>
                      </div>
                    </Td>
                    <Td>
                      <div className="flex flex-col items-start gap-1.5">
                        <StatusSelector
                          leadId={lead.id}
                          statusAtual={lead.status as StatusLead}
                        />
                        <CaioBadge ativo={lead.caio_ativo ?? true} />
                        {lead.precisa_humano && (
                          <PrecisaHumanoBadge
                            motivo={lead.precisa_humano_motivo as string | null}
                          />
                        )}
                      </div>
                    </Td>
                    <Td>
                      <span className="text-sm text-cinza-medio">
                        {lead.source}
                      </span>
                    </Td>
                    <Td>
                      <span className="text-sm text-cinza-medio">
                        {formatRelativeDate(lead.updated_at)}
                      </span>
                    </Td>
                    <Td>
                      <span className="text-sm text-cinza-medio">
                        {new Date(lead.created_at).toLocaleDateString("pt-BR")}
                      </span>
                    </Td>
                    <Td className="text-right">
                      <Link
                        href={`/dashboard/contatos/${lead.id}`}
                        className="text-sm text-laranja hover:text-laranja-escuro font-heading font-semibold"
                      >
                        Ver →
                      </Link>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Paginação */}
          <Paginator
            page={page}
            totalPages={totalPages}
            totalLeads={totalLeads ?? 0}
            offset={offset}
            shownInPage={leads.length}
            buildHref={buildHref}
          />
        </SelecaoLoteProvider>
      )}
    </div>
  );
}

function SortableTh({
  label,
  field,
  sortField,
  sortOrder,
  buildHref,
}: {
  label: string;
  field: SortField;
  sortField: SortField;
  sortOrder: SortOrder;
  buildHref: (opts: Partial<FilterParams>) => string;
}) {
  const active = sortField === field;
  // Se já tá ordenando por esse campo, inverte. Senão, default desc.
  const nextOrder: SortOrder = active && sortOrder === "desc" ? "asc" : "desc";
  const arrow = active ? (sortOrder === "desc" ? "▼" : "▲") : "";
  return (
    <th className="px-6 py-3 text-left text-xs font-heading font-semibold text-cinza-medio uppercase tracking-wider">
      <Link
        href={buildHref({ sort: field, order: nextOrder })}
        className={`inline-flex items-center gap-1.5 hover:text-laranja transition ${
          active ? "text-laranja" : ""
        }`}
      >
        {label}
        <span className="text-[10px]">{arrow}</span>
      </Link>
    </th>
  );
}

function Paginator({
  page,
  totalPages,
  totalLeads,
  offset,
  shownInPage,
  buildHref,
}: {
  page: number;
  totalPages: number;
  totalLeads: number;
  offset: number;
  shownInPage: number;
  buildHref: (opts: Partial<FilterParams>) => string;
}) {
  if (totalLeads === 0) return null;
  const inicio = offset + 1;
  const fim = offset + shownInPage;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 mt-4 px-2">
      <p className="text-xs text-cinza-medio">
        Mostrando <strong className="text-preto">{inicio}</strong> a{" "}
        <strong className="text-preto">{fim}</strong> de{" "}
        <strong className="text-preto">{totalLeads}</strong> leads
      </p>
      <div className="flex items-center gap-1">
        <PageButton
          label="‹ Anterior"
          disabled={page <= 1}
          href={buildHref({ page: String(page - 1) })}
        />
        <span className="px-3 text-xs text-cinza-medio">
          Página {page} de {totalPages}
        </span>
        <PageButton
          label="Próxima ›"
          disabled={page >= totalPages}
          href={buildHref({ page: String(page + 1) })}
        />
      </div>
    </div>
  );
}

function PageButton({
  label,
  disabled,
  href,
}: {
  label: string;
  disabled: boolean;
  href: string;
}) {
  if (disabled) {
    return (
      <span className="px-3 py-1.5 text-xs text-cinza-medio rounded-lg bg-offwhite border border-cinza-claro opacity-50">
        {label}
      </span>
    );
  }
  return (
    <Link
      href={href}
      className="px-3 py-1.5 text-xs text-preto rounded-lg bg-white border border-cinza-claro hover:border-laranja hover:text-laranja transition"
    >
      {label}
    </Link>
  );
}

function FilterChip({
  label,
  count,
  active,
  href,
  variant = "default",
}: {
  label: string;
  count?: number;
  active: boolean;
  href: string;
  variant?: "default" | "subtle";
}) {
  const baseSize =
    variant === "subtle" ? "px-2.5 py-1 text-xs" : "px-3 py-2 text-sm";
  return (
    <Link
      href={href}
      className={`flex-1 inline-flex items-center justify-center gap-2 rounded-full font-heading font-medium transition whitespace-nowrap ${baseSize} ${
        active
          ? "bg-preto text-white"
          : "bg-white text-cinza-medio border border-cinza-claro hover:border-laranja hover:text-preto"
      }`}
    >
      <span>{label}</span>
      {count !== undefined && (
        <span
          className={`text-[10px] px-1.5 py-0.5 rounded-full flex-shrink-0 ${
            active ? "bg-white/20" : "bg-cinza-claro"
          }`}
        >
          {count}
        </span>
      )}
    </Link>
  );
}

function Th({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <th
      className={`px-6 py-3 text-left text-xs font-heading font-semibold text-cinza-medio uppercase tracking-wider ${className}`}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <td className={`px-6 py-4 ${className}`}>{children}</td>;
}

function CaioBadge({ ativo }: { ativo: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-heading font-semibold border ${
        ativo
          ? "bg-green-50 text-green-700 border-green-300"
          : "bg-red-50 text-red-700 border-red-300"
      }`}
    >
      <span
        className={`w-1.5 h-1.5 rounded-full ${ativo ? "bg-green-500" : "bg-red-500"}`}
      />
      {ativo ? "Caio respondendo" : "Caio desligado"}
    </span>
  );
}

function PrecisaHumanoBadge({ motivo }: { motivo: string | null }) {
  const label =
    motivo === "muda_reuniao"
      ? "Quer mudar retirada"
      : motivo === "irritado"
        ? "Lead irritado"
        : motivo === "pede_humano"
          ? "Pediu humano"
          : "Precisa humano";
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-heading font-semibold border bg-amber-50 text-amber-800 border-amber-300"
      title="Caio passou pra humano — abra a conversa e responda"
    >
      ⚠ {label}
    </span>
  );
}

function formatRelativeDate(dateStr: string | null): string {
  if (!dateStr) return "—";
  const date = new Date(dateStr);
  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHrs = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMin < 1) return "agora";
  if (diffMin < 60) return `${diffMin}min atrás`;
  if (diffHrs < 24) return `${diffHrs}h atrás`;
  if (diffDays < 7) return `${diffDays}d atrás`;
  return date.toLocaleDateString("pt-BR");
}
