-- Pool de números do Caio (tabela org_numeros). Igual a agenda_config/evolution_instance:
-- o código (tela Admin > Números, webhook Evolution, numeros.ts) espera essa tabela,
-- mas ela foi criada na mão na Facilita e não veio nas migrations do clone.
-- Colunas derivadas de src/app/admin/clientes/[id]/numeros/actions.ts (NumeroRow + inserts).

create table if not exists org_numeros (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  instance_name text not null unique,
  numero text,
  papel text not null default 'atendimento',   -- atendimento | prospeccao | backup
  persona_nome text,
  persona_voice_id text,
  prioridade int not null default 0,
  estado text not null default 'ativo',         -- ativo | standby | caido
  status_conexao text,                          -- open | close | ...
  ativo boolean not null default true,
  ia_ativa boolean not null default true,
  numeros_teste text,
  envio_falhando boolean not null default false,
  envio_falhando_em timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_org_numeros_org on org_numeros (organization_id);
create index if not exists idx_org_numeros_papel on org_numeros (papel);

-- RLS on: o código acessa via service role (admin client). Sem policy pra authenticated
-- (comportamento documentado em dashboard/contatos: "org_numeros não tem policy de leitura pro client").
alter table org_numeros enable row level security;
