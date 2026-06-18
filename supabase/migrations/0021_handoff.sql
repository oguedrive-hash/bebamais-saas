-- Handoff: quando Caio decide passar o lead pra humano (reagendar reuniao,
-- lead irritado, lead pede pessoa). Flag visivel no painel + razao pra
-- contexto no atendimento manual.

alter table leads
  add column if not exists precisa_humano boolean default false not null,
  add column if not exists precisa_humano_motivo text,
  add column if not exists precisa_humano_em timestamptz;

create index if not exists idx_leads_precisa_humano
  on leads(precisa_humano)
  where precisa_humano = true;
