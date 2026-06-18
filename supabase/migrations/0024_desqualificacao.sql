-- Track de desqualificacao BANT. Quando Caio detectar que o lead nao encaixa
-- (autonomo sozinho, sem autoridade, volume baixo), marca aqui pra ter
-- metrica de funil comercial real (qualificados vs desqualificados).

alter table leads
  add column if not exists desqualificado boolean default false not null,
  add column if not exists desqualificacao_motivo text,
  add column if not exists desqualificado_em timestamptz;

create index if not exists idx_leads_desqualificado
  on leads(desqualificado)
  where desqualificado = true;
