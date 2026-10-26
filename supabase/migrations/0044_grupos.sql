-- =============================================================================
-- 0044 — Grupos do WhatsApp no painel (pedido da reunião de 20/10/2026)
--
-- A loja usa grupos internos no mesmo WhatsApp (financeiro com comprovantes,
-- estoque avisando falta, quem está na rua). Eles aparecem na aba "Grupos" do
-- painel, separados dos clientes: o assistente NUNCA responde em grupo, grupo
-- não entra na fila de espera e não toca aviso.
--
-- Tabelas próprias (e não `leads`/`mensagens`) de propósito: assim nenhuma regra
-- do atendimento de clientes (assistente, fila, avisos de espera) enxerga grupo.
-- =============================================================================

create table if not exists grupos (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  instance_name text not null,          -- por qual número da loja o grupo chega
  grupo_jid text not null,              -- identificador do grupo no WhatsApp (…@g.us)
  nome text,                            -- nome do grupo (vem do WhatsApp)
  nome_atualizado_em timestamptz,
  ultima_atividade_em timestamptz,
  created_at timestamptz not null default now(),
  unique (instance_name, grupo_jid)
);
create index if not exists idx_grupos_atividade
  on grupos (organization_id, ultima_atividade_em desc nulls last);

create table if not exists grupo_mensagens (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  grupo_id uuid not null references grupos(id) on delete cascade,
  direcao text not null check (direcao in ('entrada', 'saida')),
  -- membro = alguém do grupo; atendente = enviada pelo painel; celular = pelo celular da loja
  autor text not null check (autor in ('membro', 'atendente', 'celular')),
  remetente_nome text,
  remetente_numero text,
  tipo text not null default 'texto'
    check (tipo in ('texto', 'audio', 'imagem', 'arquivo', 'video', 'localizacao')),
  conteudo text,
  whatsapp_msg_id text unique,
  arquivo_path text,
  arquivo_nome text,
  arquivo_mime text,
  falha_envio boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists idx_grupo_mensagens_grupo
  on grupo_mensagens (grupo_id, created_at desc);

-- Só lê quem é da mesma empresa (ou admin). Gravação só pelo servidor (service role).
alter table grupos enable row level security;
alter table grupo_mensagens enable row level security;

drop policy if exists "Vê grupos da própria org ou admin" on grupos;
create policy "Vê grupos da própria org ou admin"
  on grupos for select
  using (organization_id = get_user_organization_id() or is_admin());

drop policy if exists "Vê mensagens de grupo da própria org ou admin" on grupo_mensagens;
create policy "Vê mensagens de grupo da própria org ou admin"
  on grupo_mensagens for select
  using (organization_id = get_user_organization_id() or is_admin());

-- Tempo real: mensagem nova de grupo aparece na hora no painel.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and tablename = 'grupo_mensagens'
    ) then
      alter publication supabase_realtime add table grupo_mensagens;
    end if;
  end if;
end $$;
