-- Reconciliação de envio: o aceite espera só 6s — se a Meta rejeitar DEPOIS
-- (caso lock 463, erro chegava 8-15s após o POST), o painel achava que
-- enviou: IA desligada + humano acha que respondeu + cliente no vácuo.
-- Guardamos o key.id do WhatsApp e um recheck marca a falha depois.

alter table mensagens add column if not exists whatsapp_msg_id text;
alter table mensagens add column if not exists falha_envio boolean not null default false;

create index if not exists idx_mensagens_whatsapp_msg_id
  on mensagens (whatsapp_msg_id)
  where whatsapp_msg_id is not null;
