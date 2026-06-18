-- Notificacao: lead mandou msg mas Caio esta desligado.
-- Set true quando: webhook recebe incoming AND caio_ativo=false
-- Set false quando: responderLead manual OU toggleCaio liga Caio

alter table leads
  add column if not exists precisa_resposta_humana boolean default false not null,
  add column if not exists precisa_resposta_em timestamptz;

create index if not exists idx_leads_precisa_resposta
  on leads(precisa_resposta_humana)
  where precisa_resposta_humana = true;
