-- =============================================================================
-- 0043 — Pré-atendente + painel de atendimento (escopo de 06/10/2026)
--
-- Cada cliente (linha em `leads`) tem um estado de atendimento:
--   bot        → o assistente está fazendo o primeiro atendimento
--   aguardando → o assistente já passou a conversa; esperando uma atendente pegar
--   atendendo  → uma atendente pegou (atribuido_a / atribuido_nome)
--   finalizado → a atendente encerrou; a próxima mensagem do cliente abre uma
--                conversa nova (volta para "bot")
-- =============================================================================

alter table leads
  add column if not exists atend_status text not null default 'bot',
  add column if not exists aguardando_desde timestamptz,
  add column if not exists assunto text,
  add column if not exists avisos_espera integer not null default 0,
  add column if not exists conversa_iniciada_em timestamptz,
  add column if not exists respostas_bot integer not null default 0,
  add column if not exists finalizado_em timestamptz,
  -- última mensagem de qualquer lado (cliente, assistente, atendente, celular)
  add column if not exists ultima_atividade_em timestamptz,
  -- até qual mensagem do cliente o assistente já respondeu (evita deixar mensagem sem resposta)
  add column if not exists assistente_viu_ate timestamptz,
  add column if not exists ultimo_aviso_em timestamptz;

-- Clientes que já existiam (sistema antigo) começam como "finalizado": a próxima
-- mensagem deles abre uma conversa nova, sem arrastar o histórico do Caio antigo.
update leads set atend_status = 'finalizado' where conversa_iniciada_em is null and atend_status = 'bot';

alter table leads drop constraint if exists leads_atend_status_check;
alter table leads add constraint leads_atend_status_check
  check (atend_status in ('bot', 'aguardando', 'atendendo', 'finalizado'));

alter table leads drop constraint if exists leads_assunto_check;
alter table leads add constraint leads_assunto_check
  check (assunto is null or assunto in ('pedido', 'orcamento', 'duvida', 'pos_venda', 'outro'));

create index if not exists idx_leads_atend_status
  on leads (organization_id, atend_status);

-- Quem escreveu cada mensagem e os dados do arquivo (foto, PDF, áudio).
alter table mensagens
  add column if not exists autor text,
  add column if not exists arquivo_path text,
  add column if not exists arquivo_nome text,
  add column if not exists arquivo_mime text;

alter table mensagens drop constraint if exists mensagens_autor_check;
alter table mensagens add constraint mensagens_autor_check
  check (autor is null or autor in ('cliente', 'assistente', 'atendente', 'celular', 'sistema'));

alter table mensagens drop constraint if exists mensagens_tipo_check;
alter table mensagens add constraint mensagens_tipo_check
  check (tipo in ('texto', 'audio', 'imagem', 'arquivo', 'video', 'localizacao'));

-- Cada mensagem do WhatsApp é gravada uma vez só (a Evolution às vezes reenvia o
-- mesmo evento). Antes do índice único, limpa eventuais duplicadas antigas.
update mensagens set whatsapp_msg_id = null
where id in (
  select id from (
    select id, row_number() over (partition by whatsapp_msg_id order by created_at) as n
    from mensagens where whatsapp_msg_id is not null
  ) t where t.n > 1
);
drop index if exists idx_mensagens_whatsapp_msg_id;
create unique index if not exists uniq_mensagens_whatsapp_msg_id on mensagens (whatsapp_msg_id);

-- Configuração do atendimento (horários, tempos) e respostas rápidas do painel.
alter table organizations
  add column if not exists atendimento_config jsonb not null default '{
    "horarios": {
      "dom": null,
      "seg": {"abre": "08:00", "fecha": "18:00"},
      "ter": {"abre": "08:00", "fecha": "18:00"},
      "qua": {"abre": "08:00", "fecha": "18:00"},
      "qui": {"abre": "08:00", "fecha": "18:00"},
      "sex": {"abre": "08:00", "fecha": "18:00"},
      "sab": {"abre": "08:00", "fecha": "13:00"}
    },
    "espera_minutos": [5, 15],
    "reiniciar_apos_horas": 6,
    "assistente_ativo": true
  }'::jsonb,
  add column if not exists respostas_rapidas jsonb not null default '[
    "Olá, bom dia!",
    "Olá, boa tarde!",
    "Ook, já vou gerar o seu pedido!!",
    "Verifique se está correto, por favor?",
    "Seu pedido está saindo para entrega.",
    "Muito obrigada!"
  ]'::jsonb;

-- Arquivos das conversas (fotos, PDFs, áudios). Bucket PRIVADO: o painel mostra
-- por link assinado temporário, nunca por URL pública.
insert into storage.buckets (id, name, public)
values ('conversas', 'conversas', false)
on conflict (id) do nothing;

-- Tempo real no painel (mensagens novas e mudança de estado chegam na hora).
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and tablename = 'mensagens'
    ) then
      alter publication supabase_realtime add table mensagens;
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and tablename = 'leads'
    ) then
      alter publication supabase_realtime add table leads;
    end if;
  end if;
end $$;

-- Nome curto do número para as atendentes saberem por onde o cliente escreveu
-- (ex.: "Loja", "Vendas"). Aparece como etiqueta em cada conversa do painel.
alter table org_numeros add column if not exists apelido text;
