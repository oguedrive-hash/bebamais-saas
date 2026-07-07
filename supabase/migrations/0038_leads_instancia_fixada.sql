-- Troca manual de atendente "gruda": sem isso, o próximo inbound do cliente
-- (que sempre chega pelo número antigo) re-carimbava evolution_instance e a
-- troca feita no painel revertia sozinha em minutos.

alter table leads add column if not exists instancia_fixada boolean not null default false;
