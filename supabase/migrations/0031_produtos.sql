-- Catálogo de produtos (contexto Beba Mais) — importado da planilha do cliente
-- ("Itens Vendidos", 531 itens: código de referência + descrição, SEM preço —
-- decisão: cotação é da equipe; o catálogo serve pra CONSULTA do atendente e,
-- futuramente, pra normalizar itens extraídos do pedido).

create table if not exists produtos (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  codigo_ref text not null,   -- código interno da equipe (600C, A1, ACC...)
  descricao text not null,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, codigo_ref)
);

create index if not exists idx_produtos_org on produtos (organization_id, ativo);

create trigger trg_produtos_updated_at
  before update on produtos
  for each row execute function update_updated_at_column();

alter table produtos enable row level security;

-- Leitura pela UI (client autenticado); escrita só via service role.
create policy "ve produtos da propria org ou admin"
  on produtos for select
  using (organization_id = get_user_organization_id() or is_admin());
