-- Tracking de lembretes enviados pro ADMIN (Lucas), separado dos lembretes
-- enviados pro lead (`lembretes_enviados`). Hardcoded 24h e 1h antes.

alter table agendamentos
  add column if not exists lembretes_admin_enviados int[] default '{}'::int[] not null;
