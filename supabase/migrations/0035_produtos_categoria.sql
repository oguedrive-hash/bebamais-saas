-- Categoria do produto (cerveja, refrigerante, agua, whisky...) — permite a
-- IA responder "quais cervejas vocês têm?" consultando o catálogo real (as
-- descrições não carregam a categoria: "Skol Lata" não contém "cerveja").
-- Backfill via classificação LLM (script one-shot); novos produtos podem
-- nascer sem categoria (a consulta simplesmente não os lista).

alter table produtos add column if not exists categoria text;

create index if not exists idx_produtos_categoria
  on produtos (organization_id, categoria)
  where ativo = true;
