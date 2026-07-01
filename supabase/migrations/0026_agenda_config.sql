-- Coluna de config da agenda (slots/janelas de atendimento).
-- O código sempre esperou `organizations.agenda_config` (ver src/lib/caio/agenda-config.ts),
-- mas ela nunca foi versionada em migration — na Facilita foi criada na mão, e o clone
-- da Beba Mais (que rodou 0001..0025) ficou sem ela. Aqui fica versionada.

alter table organizations add column if not exists agenda_config jsonb;

comment on column organizations.agenda_config is
  'AgendaConfig (src/lib/caio/agenda-config.ts): modo/dias_semana/slots/duracoes/etc. Na Beba Mais representa as janelas de RETIRADA de pedido.';
