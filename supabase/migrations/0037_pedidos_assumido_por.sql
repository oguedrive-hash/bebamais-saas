-- Quem assumiu o pedido — com 2+ atendentes a fila mostrava "Com o atendente"
-- sem dizer qual, e a colisão só aparecia no clique.

alter table pedidos add column if not exists assumido_por text;
