-- Colunas de leads que o código espera mas o clone não tinha (criadas na mão na Facilita).
-- whatsapp_jid: usada no INSERT do webhook Evolution → sem ela o insert falha e o Caio
--   nunca processa a mensagem ("[evo:webhook] sem leadId").
-- instancia_anterior: update de troca de número.
-- opt_out / opt_out_em: filtro dos crons (followup/prospecção/retomadas).

alter table leads add column if not exists whatsapp_jid text;
alter table leads add column if not exists instancia_anterior text;
alter table leads add column if not exists opt_out boolean not null default false;
alter table leads add column if not exists opt_out_em timestamptz;
