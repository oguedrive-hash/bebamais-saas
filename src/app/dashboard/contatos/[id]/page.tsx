import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { StatusSelector } from "@/components/status-selector";
import { StatusAgendamentoSelector } from "@/components/status-agendamento-selector";
import { BotaoRemarcarAgendamento } from "@/components/botao-remarcar-agendamento";
import { AtendenteSelector } from "@/components/atendente-selector";
import { TimelineMensagens } from "@/components/timeline-mensagens";
import { CaixaResposta } from "@/components/caixa-resposta";
import { RealtimeLeadUpdates } from "@/components/realtime-lead-updates";
import { ToggleCaio } from "@/components/toggle-caio";
import { ToggleFollowup } from "@/components/toggle-followup";
import { NavegacaoLeads } from "@/components/navegacao-leads";
import { TimelineEventos } from "@/components/timeline-eventos";
import { NotasLead } from "@/components/notas-lead";
import { ResumoIA } from "@/components/resumo-ia";
import { PedidoCard } from "@/components/pedido-card";
import { BotaoDeletarLead } from "@/components/botao-deletar-lead";
import { STATUS_CONFIG, type StatusLead } from "@/lib/status-config";

export default async function LeadDetalhePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string }>;
}) {
  const { id } = await params;
  const { from } = await searchParams;
  // Contexto de origem da navegacao — define entre quais leads o
  // anterior/próximo circula (o "Voltar" leva sempre pra Conversas).
  const veioDeProspeccao = from === "prospeccao";
  const supabase = await createClient();

  // Paraleliza as queries Supabase
  const [
    { data: lead, error },
    { data: agendamentos },
    { data: mensagens },
    { data: idsLeads },
    { data: eventos },
    { data: pedidos },
  ] = await Promise.all([
    supabase.from("leads").select("*").eq("id", id).single(),
    supabase
      .from("agendamentos")
      .select("id, data_inicio, data_fim, status, meet_link, observacoes")
      .eq("lead_id", id)
      .order("data_inicio", { ascending: false }),
    // Últimas 300 mensagens (cliente recorrente acumula milhares — sem limit,
    // cada render/realtime re-baixava a conversa inteira). Busca desc + limit
    // e reverte pra ordem cronológica.
    supabase
      .from("mensagens")
      .select(
        "id, conteudo, tipo, attachment_url, direcao, remetente_nome, shadow, falha_envio, created_at",
      )
      .eq("lead_id", id)
      .order("created_at", { ascending: false })
      .limit(300),
    // Lista de IDs ordenada (mesma ordem da lista) pra navegação anterior/próximo.
    // Se o user veio da pagina de prospeccao, navega apenas entre leads
    // outbound — senao navega entre todos os inbound.
    (veioDeProspeccao
      ? supabase
          .from("leads")
          .select("id")
          .eq("origem", "prospeccao")
          .order("updated_at", { ascending: false })
          .limit(500)
      : supabase
          .from("leads")
          .select("id")
          .eq("origem", "inbound")
          .order("updated_at", { ascending: false })
          .limit(500)),
    // Timeline de eventos do lead (últimos 50)
    supabase
      .from("lead_eventos")
      .select("id, tipo, descricao, autor_nome, created_at")
      .eq("lead_id", id)
      .order("created_at", { ascending: false })
      .limit(50),
    // Pedidos do lead (aberto no topo + histórico do cliente recorrente)
    supabase
      .from("pedidos")
      .select(
        "id, status, itens, modalidade, endereco, nome_cliente, obs, confirmado_em, created_at, updated_at",
      )
      .eq("lead_id", id)
      .order("created_at", { ascending: false })
      .limit(10),
  ]);

  if (error || !lead) {
    notFound();
  }

  // Números do pool da org (pra trocar manualmente quem atende o lead). Via admin
  // client porque org_numeros não tem policy de leitura pro client do usuário.
  const { data: poolNumeros } = await createAdminClient()
    .from("org_numeros")
    .select("instance_name, persona_nome")
    .eq("organization_id", lead.organization_id)
    .eq("ativo", true)
    .order("prioridade", { ascending: true });

  // Estado da IA: leads.caio_ativo no Supabase é a ÚNICA fonte da verdade
  // (Chatwoot desativado / migrado p/ Evolution). O webhook reativo e o toggle
  // do painel mantêm esse campo atualizado no banco — não relê do Chatwoot.
  const caioAtivo = lead.caio_ativo ?? true;

  const statusConfig = STATUS_CONFIG[lead.status as StatusLead];

  // Encontra próximo / anterior na lista ordenada
  const ids = (idsLeads ?? []).map((l) => l.id);
  const idx = ids.indexOf(lead.id);
  const anteriorId = idx > 0 ? ids[idx - 1] : null;
  const proximoId = idx >= 0 && idx < ids.length - 1 ? ids[idx + 1] : null;
  const totalNavegavel = ids.length;
  const posicao = idx + 1;

  return (
    <div>
      <RealtimeLeadUpdates leadId={lead.id} />

      {/* Breadcrumb + navegação anterior/próximo */}
      <div className="flex items-center justify-between gap-3 mb-3">
        <Link
          href="/dashboard/contatos"
          className="inline-flex items-center text-sm text-cinza-medio hover:text-laranja font-heading font-medium transition"
        >
          ← Voltar pra Conversas
        </Link>
        {totalNavegavel > 1 && (
          <NavegacaoLeads
            anteriorId={anteriorId}
            proximoId={proximoId}
            posicao={posicao}
            total={totalNavegavel}
          />
        )}
      </div>

      {/* Header compacto: nome + telefone + status numa altura só */}
      <div className="bg-white rounded-2xl border border-cinza-claro p-5 mb-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-heading font-bold text-preto">
              {lead.nome ?? "Sem nome"}
              <span className="text-sm text-cinza-medio font-mono font-normal ml-3">
                {lead.telefone}
              </span>
            </h1>
            {/* Badge de origem escondido — prospecção desligada por enquanto */}
            <div
              className={`inline-block px-3 py-1 rounded-lg text-xs mt-2 ${statusConfig.bg} ${statusConfig.cor} border ${statusConfig.border}`}
            >
              {statusConfig.descricao}
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <StatusSelector
              leadId={lead.id}
              statusAtual={lead.status as StatusLead}
              incluirProspeccao={lead.origem === "prospeccao"}
            />
            {lead.chatwoot_conversation_id && (
              <ToggleCaio leadId={lead.id} caioAtivoInicial={caioAtivo} />
            )}
            {poolNumeros && poolNumeros.length > 1 && (
              <AtendenteSelector
                leadId={lead.id}
                atual={lead.evolution_instance ?? null}
                opcoes={poolNumeros}
                fixado={lead.instancia_fixada === true}
              />
            )}
            {/* Botões de mover pra Prospecção / voltar pra Inbound escondidos —
                prospecção desligada por enquanto. Componentes continuam em
                ./botao-enviar-prospeccao e ./botao-voltar-inbound. */}
          </div>
        </div>

        {/* Razão (se houver) */}
        {lead.razao && (
          <div className="mt-3 p-3 bg-offwhite rounded-lg border border-cinza-claro">
            <p className="text-xs font-heading font-semibold text-cinza-medio uppercase tracking-wider mb-1">
              Razão / Observação
            </p>
            <p className="text-sm text-preto">{lead.razao}</p>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Coluna esquerda — Info */}
        <div className="md:col-span-2 space-y-4">
          {/* Histórico de mensagens + caixa de resposta */}
          <Card titulo="Conversa">
            <TimelineMensagens
              mensagens={[...(mensagens ?? [])].reverse()}
              caioProcessingSince={lead.caio_processing_since ?? null}
            />
            <CaixaResposta
              leadId={lead.id}
              podeResponder={Boolean(lead.chatwoot_conversation_id)}
            />
          </Card>

          {/* Retiradas — só aparece quando existe alguma (card vazio é ruído) */}
          {(agendamentos ?? []).length > 0 && (
            <Card titulo="Retiradas">
              <ul className="space-y-3">
                {(agendamentos ?? []).map((a) => (
                  <li
                    key={a.id}
                    className="p-4 bg-offwhite rounded-lg border border-cinza-claro"
                  >
                    <div className="flex items-center justify-between mb-2 gap-3">
                      <p className="font-heading font-semibold text-preto">
                        {dtCurto(a.data_inicio)}
                      </p>
                      {/* Dropdown de status: é AQUI que a equipe confirma o
                          horário sugerido (a notificação do admin linka pra
                          esta página) */}
                      <div className="flex items-center gap-3">
                        <BotaoRemarcarAgendamento
                          agendamentoId={a.id}
                          leadNome={lead.nome ?? null}
                        />
                        <StatusAgendamentoSelector
                          agendamentoId={a.id}
                          statusAtual={a.status}
                        />
                      </div>
                    </div>
                    {a.meet_link && (
                      <a
                        href={a.meet_link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-laranja hover:underline"
                      >
                        Link da retirada →
                      </a>
                    )}
                    {a.observacoes && (
                      <p className="text-sm text-cinza-medio mt-2">
                        {a.observacoes}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>

        {/* Coluna direita — Metadata */}
        <div className="space-y-4">
          {(pedidos ?? []).length > 0 && (
            <Card titulo="Pedido">
              <div className="space-y-3">
                {(pedidos ?? []).map((p, idx) => (
                  <PedidoCard
                    key={p.id}
                    pedido={p}
                    compacto={idx > 0} // só o mais recente tem ações/edição
                  />
                ))}
              </div>
            </Card>
          )}

          <Card titulo="Resumo IA">
            <ResumoIA
              leadId={lead.id}
              resumoInicial={lead.resumo_ia ?? null}
              geradoEm={lead.resumo_gerado_em ?? null}
            />
          </Card>

          <Card titulo="Follow-up">
            <ToggleFollowup
              leadId={lead.id}
              ativoInicial={lead.followup_ativo ?? true}
              proximoEm={lead.proximo_followup_em ?? null}
              numeroAtual={lead.numero_followup ?? 0}
            />
          </Card>

          <Card titulo="Notas internas">
            <NotasLead leadId={lead.id} notasIniciais={lead.notas ?? null} />
          </Card>

          <Card titulo="Histórico">
            <TimelineEventos eventos={eventos ?? []} />
          </Card>

          <Card titulo="Detalhes">
            <dl className="space-y-3">
              <DataRow label="Origem" valor={lead.source} />
              <DataRow label="Criado em" valor={dtCurto(lead.created_at)} />
              <DataRow
                label="Última atividade"
                valor={dtCurto(lead.updated_at)}
              />
              {lead.numero_followup > 0 && (
                <DataRow
                  label="Follow-ups enviados"
                  valor={String(lead.numero_followup)}
                />
              )}
              {lead.proximo_followup_em && (
                <DataRow
                  label="Próximo follow-up"
                  valor={dtCurto(lead.proximo_followup_em)}
                />
              )}
              {/* Chatwoot ID removido — Chatwoot foi desativado (fluxo roda
                  100% na Evolution); o id segue no banco se precisar. */}
            </dl>
          </Card>

          {/* Zona de perigo */}
          <div className="bg-white rounded-2xl border border-red-200 p-4">
            <p className="text-xs font-heading font-semibold text-red-700 uppercase tracking-wider mb-2">
              Zona de perigo
            </p>
            <BotaoDeletarLead
              leadId={lead.id}
              nomeLead={lead.nome ?? lead.telefone}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

// Datas curtas (sem segundos) pros metadados
function dtCurto(dateStr: string): string {
  return new Date(dateStr).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function Card({
  titulo,
  children,
}: {
  titulo: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-2xl border border-cinza-claro p-5">
      <h2 className="text-lg font-heading font-bold text-preto mb-3">
        {titulo}
      </h2>
      {children}
    </div>
  );
}

function DataRow({ label, valor }: { label: string; valor: string }) {
  return (
    <div>
      <dt className="text-xs font-heading font-semibold text-cinza-medio uppercase tracking-wider mb-0.5">
        {label}
      </dt>
      <dd className="text-sm text-preto">{valor}</dd>
    </div>
  );
}
