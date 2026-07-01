-- Coluna evolution_instance em leads (nome da instância Evolution que atendeu o lead).
-- Igual à agenda_config: o código (gerar-resposta.ts, personaDoLead) espera essa
-- coluna, mas ela não estava versionada em migration — na Facilita foi criada na
-- mão, e o clone da Beba Mais (0001..0025) ficou sem. Sem ela, o SELECT de leads
-- falha e o Caio responde "Lead sem organization vinculada".

alter table leads add column if not exists evolution_instance text;
