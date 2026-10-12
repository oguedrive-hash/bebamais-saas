-- =============================================================================
-- 0042 — Correções de segurança (diagnóstico de 28/09/2026)
--
-- 1) Escalada de privilégio: a policy "Próprio profile pode atualizar" deixava
--    qualquer usuário logado mudar o PRÓPRIO role (virar admin) e o
--    organization_id via API do Supabase. Todo update legítimo de profiles é
--    feito pelo servidor com service role (admin client), então a policy de
--    update para usuários sai. Além disso, um trigger barra mudança de role /
--    organization_id por quem não for service role (defesa em profundidade).
-- 2) Tabelas aquecimento_* (código removido em 25/06) estavam sem RLS e com
--    grant total para usuários logados. Saem.
-- =============================================================================

drop policy if exists "Próprio profile pode atualizar" on profiles;

create or replace function bloquear_troca_de_cargo()
returns trigger
language plpgsql
as $$
begin
  if current_user not in ('service_role', 'postgres', 'supabase_admin') then
    if new.role is distinct from old.role
       or new.organization_id is distinct from old.organization_id then
      raise exception 'Alteração de cargo ou empresa não permitida';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_bloquear_troca_de_cargo on profiles;
create trigger trg_bloquear_troca_de_cargo
  before update on profiles
  for each row execute function bloquear_troca_de_cargo();

drop table if exists aquecimento_log;
drop table if exists aquecimento_numeros;
