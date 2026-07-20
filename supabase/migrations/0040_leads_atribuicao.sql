-- ============================================
-- Atribuição de conversa a um atendente (reunião Beba Mais 07/2026, item 8).
-- Com 4+ atendentes num único número, havia duplicação de esforço e
-- "competição" por pedidos grandes: ninguém sabia quem estava com qual cliente.
-- Agora cada conversa pode ser ATRIBUÍDA a um atendente — a lista filtra por
-- "minhas" / "não atribuídas", e o painel registra quem assumiu (responsabilização).
--
-- Denormaliza o NOME do atendente (atribuido_nome) além do id: a policy de RLS
-- de `profiles` só deixa cada usuário ler o PRÓPRIO profile, então um join
-- pra mostrar "quem pegou" pra OUTRO atendente voltaria null. O nome é gravado
-- pela server action (que lê o próprio profile do usuário logado).
-- ============================================

alter table leads add column if not exists atribuido_a uuid
  references profiles(id) on delete set null;
alter table leads add column if not exists atribuido_nome text;
alter table leads add column if not exists atribuido_em timestamptz;

-- Filtro "minhas conversas" / "não atribuídas" na lista de Conversas
create index if not exists idx_leads_atribuido_a on leads (atribuido_a)
  where atribuido_a is not null;
