-- ============================================
-- Forma de pagamento anotada no pedido (reunião Beba Mais 07/2026).
-- A IA pergunta e ANOTA a forma (pix/cartao/dinheiro); a equipe finaliza o
-- VALOR e envia os dados de cobrança (ex: chave PIX com o valor certo). A IA
-- não fecha valor nem manda chave — só registra a forma pro humano/motorista.
-- ============================================

alter table pedidos add column if not exists forma_pagamento text
  check (forma_pagamento in ('pix', 'cartao', 'dinheiro'));
-- Troco: só faz sentido em dinheiro. Texto livre ("100", "para 50") — a IA
-- anota o que o cliente disser; a equipe interpreta.
alter table pedidos add column if not exists troco_para text;
