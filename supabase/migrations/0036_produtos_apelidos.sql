-- Apelidos/sinônimos populares do produto ("latão", "litrão", "600",
-- "long neck"...). O cliente pede por apelido que NÃO existe na descrição
-- ("2 latão de skol" vs "Skol Lata 473ml") — o matcher e a busca passam a
-- considerar esses tokens. Backfill via LLM; editável na tela de Produtos.

alter table produtos add column if not exists apelidos text[] not null default '{}';
