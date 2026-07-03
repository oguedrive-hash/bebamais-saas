-- O botão "Deletar agendamento" usa o client autenticado (RLS), mas a tabela
-- nunca teve policy de DELETE — o delete casava 0 linhas e retornava ok
-- silenciosamente (o card continuava na tela). Espelha a policy de UPDATE.

drop policy if exists "Deleta agendamentos da própria org" on agendamentos;

create policy "Deleta agendamentos da própria org"
  on agendamentos for delete
  using (organization_id = get_user_organization_id() or is_admin());
