-- Módulo de AQUECIMENTO (maturação de chip), SEPARADO do pool de leads (org_numeros).
-- Números "ancora" (já maduros, IA off, só aquecem) conversam com números "aquecendo"
-- (novos). Um número pode estar AQUI e no pool ao mesmo tempo (esquema duplo): o webhook
-- da Evolution roteia tráfego vindo de um número de aquecimento pro aquecedor, NÃO pro
-- Caio — evita loop bot↔bot. Ver lib/caio/aquecimento.ts + /admin/aquecimento.
--
-- Segurança: igual org_numeros — RLS off, grants pra service_role + authenticated;
-- o escopo por organization_id é aplicado nas queries do app (single-tenant por clone).

create table if not exists aquecimento_numeros (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references organizations(id) on delete cascade,
  instance_name      text not null,
  numero             text,                 -- E.164 sem +, usado pra rotear inbound de aquecimento
  apelido            text,                 -- rótulo amigável ("meu pessoal", "chip novo 1")
  papel              text not null default 'aquecendo'
                       check (papel in ('ancora', 'aquecendo')),
  estado             text not null default 'ativo'
                       check (estado in ('ativo', 'pausado', 'caido')),
  status_conexao     text,                 -- open / close / connecting (espelho da Evolution)
  aquecimento_inicio timestamptz not null default now(),  -- dirige a rampa + a temperatura
  alvo_diario        integer,              -- override opcional da rampa-por-dias
  falhas_seguidas    integer not null default 0,          -- envios falhando seguidos -> pausa
  ultimo_erro_em     timestamptz,
  ultimo_check_em    timestamptz,
  ativo              boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (organization_id, instance_name)
);

create index if not exists aquecimento_numeros_org_papel_estado_idx
  on aquecimento_numeros (organization_id, papel, estado);
create index if not exists aquecimento_numeros_numero_idx
  on aquecimento_numeros (numero);

create table if not exists aquecimento_log (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  de_instance     text not null,           -- quem enviou (instância)
  para_instance   text,                    -- instância destino (quando é número↔número do pool)
  para_numero     text,                    -- número/grupo destino
  tipo            text not null default 'text'
                    check (tipo in ('text', 'audio', 'sticker', 'image', 'grupo')),
  created_at      timestamptz not null default now()
);

create index if not exists aquecimento_log_de_instance_created_idx
  on aquecimento_log (de_instance, created_at desc);
create index if not exists aquecimento_log_org_created_idx
  on aquecimento_log (organization_id, created_at desc);

alter table aquecimento_numeros disable row level security;
alter table aquecimento_log     disable row level security;
grant all on aquecimento_numeros to service_role, authenticated;
grant all on aquecimento_log     to service_role, authenticated;

notify pgrst, 'reload schema';
