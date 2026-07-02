-- ============================================
-- Pedidos — pré-venda estruturada extraída por IA (contexto Beba Mais).
-- O Caio conversa, o extrator (src/lib/caio/extrator-pedido.ts) mantém o
-- pedido estruturado, e o atendente humano finaliza no painel.
-- Tabela própria (não estende agendamentos): pedido existe antes de/sem
-- hora marcada, a fila do atendente filtra por status, e cliente
-- recorrente acumula N pedidos ao longo do tempo.
-- ============================================

create table if not exists pedidos (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  lead_id uuid not null references leads(id) on delete cascade,
  agendamento_id uuid references agendamentos(id) on delete set null,

  itens jsonb not null default '[]'::jsonb,      -- [{produto, quantidade, unidade?}]
  modalidade text check (modalidade in ('retirada', 'entrega')),
  endereco text,                                  -- só quando modalidade = entrega
  nome_cliente text,                              -- nome DITO na conversa (≠ pushName)
  obs text,                                       -- notas do atendente

  status text not null default 'captando' check (status in (
    'captando', 'pronto_para_equipe', 'em_atendimento', 'finalizado', 'cancelado'
  )),

  editado_pelo_painel boolean not null default false, -- humano editou → extrator não sobrescreve
  confirmado_em timestamptz,          -- quando o cliente confirmou o recap
  equipe_notificada_em timestamptz,   -- dedup da notificação ao admin
  finalizado_em timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Fila do atendente: filtra org+status, ordena por atividade
create index if not exists idx_pedidos_org_status on pedidos (organization_id, status, updated_at desc);
-- Card no detalhe do lead + histórico do cliente recorrente
create index if not exists idx_pedidos_lead on pedidos (lead_id, created_at desc);
-- No máximo UM pedido aberto por lead (extrator faz upsert; corrida cai em 23505 e re-seleciona)
create unique index if not exists uniq_pedido_aberto_por_lead on pedidos (lead_id)
  where status in ('captando', 'pronto_para_equipe', 'em_atendimento');

create trigger trg_pedidos_updated_at
  before update on pedidos
  for each row execute function update_updated_at_column();

alter table pedidos enable row level security;

-- UI lê direto com o client autenticado (mesmo padrão de leads/agendamentos).
-- Escrita SÓ via service role (extrator + server actions usam createAdminClient).
create policy "ve pedidos da propria org ou admin"
  on pedidos for select
  using (organization_id = get_user_organization_id() or is_admin());
