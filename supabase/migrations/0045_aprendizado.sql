-- =============================================================================
-- 0045 — Aprendizado: WhatsApp da loja conectado SÓ PARA LER
--
-- O WhatsApp de maior movimento da loja é conectado sem responder ninguém: o
-- assistente nunca fala por ele e nada daqui vira cliente no painel. As
-- conversas reais (cliente e equipe) são copiadas para cá, para descobrir as
-- perguntas mais comuns, os produtos mais pedidos e o jeito de a equipe falar,
-- e assim ajustar as informações da loja e o tom do assistente.
--
-- As mensagens ficam AQUI, e não só na Evolution, porque a Evolution apaga as
-- mensagens de um número quando ele é removido. Mesmo modelo usado na
-- iBrasileira (migration 0067 de lá).
--
-- Sem policy de leitura para usuários: só o servidor (service role) lê, e a
-- tela é só de administrador.
-- =============================================================================

-- Qual instância da Evolution está captando (no máximo uma por loja).
create table if not exists aprendizado_config (
  organization_id uuid primary key references organizations(id) on delete cascade,
  instance_name text not null,
  status_conexao text,            -- open | close | connecting
  numero text,                    -- dígitos do WhatsApp da loja, quando conectado
  conectado_em timestamptz,
  historico_importado_em timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table aprendizado_config enable row level security;

create table if not exists aprendizado_mensagens (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  instance_name text not null,
  msg_id text not null,
  conversa_jid text not null,     -- conversa (o cliente)
  telefone text,                  -- dígitos do cliente, quando o WhatsApp informa
  nome_contato text,              -- nome do perfil do cliente
  direcao text not null check (direcao in ('cliente', 'equipe')),
  tipo text not null default 'texto',
  conteudo text,
  enviada_em timestamptz not null,
  origem text not null default 'ao_vivo' check (origem in ('ao_vivo', 'historico')),
  created_at timestamptz not null default now(),
  unique (instance_name, msg_id)
);
create index if not exists idx_aprendizado_msg_conversa
  on aprendizado_mensagens (organization_id, conversa_jid, enviada_em);
create index if not exists idx_aprendizado_msg_quando
  on aprendizado_mensagens (organization_id, enviada_em);
alter table aprendizado_mensagens enable row level security;

-- Contatos que NÃO devem ser captados (conversa pessoal, fornecedor...).
create table if not exists aprendizado_excluidos (
  organization_id uuid not null references organizations(id) on delete cascade,
  conversa_jid text not null,
  created_at timestamptz not null default now(),
  primary key (organization_id, conversa_jid)
);
alter table aprendizado_excluidos enable row level security;

-- Uma linha por conversa, para a lista da tela (agrupa no banco, não no Node).
create or replace view aprendizado_conversas
with (security_invoker = true) as
select organization_id,
       conversa_jid,
       max(nome_contato) filter (where direcao = 'cliente') as nome_contato,
       max(telefone) as telefone,
       count(*) as mensagens,
       count(*) filter (where direcao = 'equipe') as da_equipe,
       min(enviada_em) as primeira,
       max(enviada_em) as ultima
  from aprendizado_mensagens
 group by organization_id, conversa_jid;
