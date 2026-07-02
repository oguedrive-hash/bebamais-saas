-- "Em falta": disponivel=false mantém o produto no catálogo (riscado na UI),
-- diferente de ativo=false (removido do catálogo). O atendente alterna na tela.
alter table produtos add column if not exists disponivel boolean not null default true;
