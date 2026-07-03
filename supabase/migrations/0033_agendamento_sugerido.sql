-- Horário como SUGESTÃO (03/07/2026): a IA não marca compromisso — anota o
-- horário que o cliente quer (retirada ou entrega) como status 'sugerido' e a
-- equipe confirma no painel (muda pra 'agendado'). Sem checagem de conflito:
-- loja atende N clientes ao mesmo tempo.

alter table agendamentos
  drop constraint if exists agendamentos_status_check;

alter table agendamentos
  add constraint agendamentos_status_check
  check (status in ('sugerido', 'agendado', 'realizado', 'no_show', 'cancelado'));
