# Beba Mais — Pré-atendente e painel de atendimento

Sistema de atendimento no WhatsApp do Beba Mais Distribuidora, feito pela Facilita Plus.

**O que ele faz**

- **Pré-atendente:** responde o cliente na hora, entende o assunto (pedido, orçamento, dúvida ou pós-venda), responde dúvidas simples e passa a conversa para uma atendente. Não passa preço, não fecha pedido e não promete prazo de entrega.
- **Painel das atendentes (`/atendimento`):** uma tela só com "Esperando atendente" e "Minhas conversas". A atendente pega o cliente, responde, envia foto ou arquivo (pode colar o print do pedido com Ctrl+V), usa respostas prontas, passa para outra atendente e finaliza.
- **Vários números:** todos os números de WhatsApp caem no mesmo painel, e a resposta sai pelo número em que o cliente escreveu.
- **Mensagem de espera:** se ninguém pegar o cliente em 5 e em 15 minutos, o assistente avisa que já vão responder.
- **Configurações (`/admin`, só administradores):** informações da loja usadas pelo assistente, horários, tempos de espera, respostas prontas, números (conexão por QR Code e modo teste) e atendentes.

## Como funciona uma conversa

```
cliente escreve ─▶ assistente responde ─▶ "Esperando atendente" ─▶ atendente pega ─▶ finaliza
                     (bot)                    (aguardando)           (atendendo)     (finalizado)
```

- Se alguém responder pelo celular, o assistente sai da conversa na hora.
- Depois de finalizado, ou com a conversa parada por 6 horas, a próxima mensagem do cliente começa uma conversa nova com o assistente.

## Tecnologia

- **Painel:** Next.js 16 (App Router) e TypeScript.
- **Banco de dados:** Supabase (Postgres, login, arquivos e tempo real).
- **WhatsApp:** Evolution API v2.3.7.
- **IA:** OpenAI, com gpt-4o-mini para o assistente e Whisper para transcrever áudio.

## Onde está cada coisa

| Caminho | Conteúdo |
| --- | --- |
| `src/lib/atendimento/regras.ts` | Regras do fluxo, como horários, estados e mensagens de espera (testadas) |
| `src/lib/atendimento/assistente.ts` | Instruções e travas do pré-atendente |
| `src/lib/atendimento/inbound.ts` | Mensagens que chegam do WhatsApp: texto, áudio, foto, arquivo e localização |
| `src/lib/atendimento/whatsapp.ts` | Envio para o cliente e registro no histórico |
| `src/app/atendimento/` | Painel das atendentes |
| `src/app/admin/` | Configurações |
| `src/app/api/webhooks/evolution` | Entrada das mensagens (autenticada por token) |
| `src/app/api/cron/espera` | Rotina da mensagem de espera |
| `supabase/migrations/` | Estrutura do banco (rodar em ordem) |
| `deploy/` | Instalação na VPS (Docker) |

## Rodar em desenvolvimento

```bash
npm install
cp .env.example .env.local   # e preencher
npm run dev                  # http://localhost:3000
npm test                     # testes das regras do atendimento
```

## Instalar em produção

Veja o passo a passo em [INSTALACAO.md](INSTALACAO.md).
