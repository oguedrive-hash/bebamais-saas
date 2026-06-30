# Manual de clonagem — colocar o Caio num cliente novo (VPS dedicada)

Modelo: **1 cliente = 1 VPS** com stack próprio (orquestrado por **EasyPanel + Traefik**,
igual à Facilita). A imagem do painel é a mesma base (GHCR), mas **cada cliente precisa
do build próprio** por causa do Supabase embutido (ver Passo 4). Código já é clone-safe
(ver [CLONAGEM.md](CLONAGEM.md) — Fase 1).

Stack que compõe um cliente (espelho da Facilita):
`painel` · `evolution-api` (+ `-db` postgres + `-redis`) · `supabase` (self-host) · crons.
(`n8n`, `chatwoot`, `dbgate` são opcionais / não fazem parte do Caio.)

Legenda: **[AUTO]** = script/comando pronto · **[SEMI]** = comando + 1 valor a preencher ·
**[MANUAL]** = passo operacional (UI/provisão).

---

## Passo 0 — Provisionar a VPS  **[MANUAL]**
- Subir uma VPS (mesma pegada da Facilita: ~4 vCPU / 8GB pra folga com Supabase).
- Apontar o DNS do cliente pros subdomínios: `app.CLIENTE.com.br` (painel),
  `evolution.CLIENTE.com.br`, `supabase.CLIENTE.com.br`.
- Abrir portas 80/443 (Traefik faz o TLS via Let's Encrypt).

## Passo 1 — Instalar EasyPanel + Traefik  **[MANUAL]**
- Instalar o EasyPanel (`curl -sSL https://get.easypanel.io | sh`). Ele já sobe o Traefik.
- Criar um **projeto** (ex: `cliente_x`). Todos os serviços abaixo vão nele.
- Em cada serviço com domínio, ativar HTTPS (EasyPanel pede o domínio e o Traefik emite o cert).

## Passo 2 — Supabase self-hosted  **[SEMI]**
A Facilita roda o Supabase como **app de compose** no EasyPanel (dir
`/etc/easypanel/projects/facilita/supabase/code`). Pro cliente:
1. No EasyPanel, criar um app do tipo **Compose** chamado `supabase` (usar o
   `docker-compose.yml` oficial do Supabase self-hosting).
2. **Gerar chaves NOVAS** (NUNCA reusar as da Facilita — as atuais são demo):
   `POSTGRES_PASSWORD`, `JWT_SECRET` (32+ chars), e a partir do JWT_SECRET as
   `ANON_KEY` e `SERVICE_ROLE_KEY` (gerar em https://supabase.com/docs/guides/self-hosting#api-keys
   ou via script jwt). Também `DASHBOARD_USERNAME/PASSWORD`.
3. Expor a API em `https://supabase.CLIENTE.com.br`.
4. Anotar: `NEXT_PUBLIC_SUPABASE_URL` (= a URL acima), `ANON_KEY`, `SERVICE_ROLE_KEY`.

> ⚠️ Esse é o passo mais "manual" — o Supabase self-host é um stack próprio de ~10
> serviços. Não dá pra empacotar junto sem fragilizar; segue o guia oficial dele.

## Passo 3 — Evolution API (+db +redis)  **[SEMI]**
No projeto, criar 3 serviços (copiar da Facilita trocando os valores):
- `evolution-api-db` → imagem `postgres:17`, com `POSTGRES_PASSWORD` novo.
- `evolution-api-redis` → imagem `redis:7`.
- `evolution-api` → imagem `evoapicloud/evolution-api:v2.3.7` (NÃO subir pra v2.4+ — vira PAGO/licenciado), domínio `evolution.CLIENTE.com.br`, env:

```bash
SERVER_TYPE=http
SERVER_PORT=8080
SERVER_URL=https://evolution.CLIENTE.com.br
AUTHENTICATION_API_KEY=<GERAR 32 chars novo>      # = EVOLUTION_API_KEY no painel
DATABASE_PROVIDER=postgresql
DATABASE_CONNECTION_URI=postgresql://postgres:<senha>@evolution-api-db:5432/evolution
DATABASE_CONNECTION_CLIENT_NAME=evolution_exchange
DATABASE_SAVE_DATA_INSTANCE=true
DATABASE_SAVE_DATA_NEW_MESSAGE=true
DATABASE_SAVE_MESSAGE_UPDATE=true
DATABASE_SAVE_DATA_CONTACTS=true
DATABASE_SAVE_DATA_CHATS=true
CACHE_REDIS_ENABLED=true
CACHE_REDIS_URI=redis://evolution-api-redis:6379/6
CACHE_REDIS_PREFIX_KEY=evolution
CORS_ORIGIN=*
DEL_INSTANCE=false
LOG_LEVEL=ERROR,WARN,INFO
```
> O `remoteJidAlt` (resolução número↔@lid) já vem nessa versão — ver [[project_aquecedor_deploy_e_lid]].

## Passo 4 — Build da imagem do painel pro cliente  **[SEMI]**
`NEXT_PUBLIC_SUPABASE_URL/ANON_KEY` são **build-time** (embutidas no bundle do browser),
então a imagem da Facilita NÃO serve — precisa de um build com o Supabase DO CLIENTE.
Duas formas:

**A) Recomendada — GitHub Actions `workflow_dispatch`:** rodar o workflow `build-image`
passando o Supabase do cliente como inputs, gerando uma tag própria (ex:
`ghcr.io/oguedrive-hash/facilita-painel:cliente_x`). (Ver "Automação pendente" no fim —
o workflow precisa ganhar os inputs; hoje só usa as repo Variables da Facilita.)

**B) Fallback — build local na VPS do cliente:**
```bash
git clone <repo> && cd facilita-saas
docker build -t painel_cliente_x:latest \
  --build-arg NEXT_PUBLIC_SUPABASE_URL=https://supabase.CLIENTE.com.br \
  --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon do cliente> .
```

## Passo 5 — Subir o painel  **[SEMI]**
Criar o serviço `painel` (imagem do Passo 4), domínio `app.CLIENTE.com.br`, `PORT=80`,
e o **env completo** do cliente — usar o contrato de [CLONAGEM.md](CLONAGEM.md). As 🔴
client-specific (sem elas o `assertTenantConfig` BARRA — é proposital):
`DEFAULT_ORG_ID`, `DEFAULT_INSTANCE_NAME`, `APP_BASE_URL`, `ADMIN_WHATSAPP_NUMBER`,
`SUPABASE_SERVICE_ROLE_KEY`, `EVOLUTION_API_URL`, `EVOLUTION_API_KEY`, `OPENAI_API_KEY`,
`CRON_SECRET` (novo). + `EVOLUTION_RECEBE=1`, `EVOLUTION_ENVIO_TODOS=1`, `TZ`.

> ⚠️ SEMPRE setar o env COMPLETO na UI do EasyPanel (não via `docker service update --env-add`):
> o EasyPanel reseta o spec no Deploy e dropa env de swarm → quebra o Caio. (Já mordeu 2x.)

## Passo 6 — Schema no Supabase do cliente  **[AUTO]**
Rodar as migrations contra o Postgres do Supabase do cliente:
```bash
# de dentro do repo, apontando pro DB do cliente:
for f in supabase/migrations/0*.sql; do psql "$DATABASE_URL_DO_CLIENTE" -f "$f"; done
```
(ou via Supabase Studio → SQL Editor, colando na ordem 0001→0025).

## Passo 7 — Seed da organização  **[AUTO]**
O `organizations` é o cérebro de config (persona/prompt/base/voz por linha). Seed mínimo
(o `id` TEM que bater com o `DEFAULT_ORG_ID` do env do painel):
```sql
insert into organizations (id, name, email_contato, ativo)
values ('<DEFAULT_ORG_ID>', 'Cliente X', 'contato@clientex.com.br', true);
```
O resto (prompt_system, base_conhecimento, agenda_config, followup_config, voz) é melhor
preencher pela tela do painel (Passo 10). **Login do cliente:** criar usuário no Supabase
Auth (Studio → Authentication → Add user) e a linha em `profiles` com
`organization_id = <DEFAULT_ORG_ID>` e `role = 'admin'`.

## Passo 8 — Crons  **[AUTO]**
Criar `/etc/cron.d/CLIENTE-cron` na VPS (followup 4x/min, prospecção 4x/min, lembretes e
retomadas 1x/min). Trocar o domínio e o `CRON_SECRET`:
```cron
# Followup — :00/:15/:30/:45 (responsividade 15s)
* * * * * root curl -sS -X POST -H "Authorization: Bearer <CRON_SECRET>" https://app.CLIENTE.com.br/api/cron/followup > /var/log/CLIENTE-followup.log 2>&1
* * * * * root sleep 15 && curl -sS -X POST -H "Authorization: Bearer <CRON_SECRET>" https://app.CLIENTE.com.br/api/cron/followup > /var/log/CLIENTE-followup.log 2>&1
* * * * * root sleep 30 && curl -sS -X POST -H "Authorization: Bearer <CRON_SECRET>" https://app.CLIENTE.com.br/api/cron/followup > /var/log/CLIENTE-followup.log 2>&1
* * * * * root sleep 45 && curl -sS -X POST -H "Authorization: Bearer <CRON_SECRET>" https://app.CLIENTE.com.br/api/cron/followup > /var/log/CLIENTE-followup.log 2>&1
# Lembretes + retomadas — 1/min
* * * * * root curl -sS -X POST -H "Authorization: Bearer <CRON_SECRET>" https://app.CLIENTE.com.br/api/cron/lembretes > /var/log/CLIENTE-lembretes.log 2>&1
* * * * * root curl -sS -X POST -H "Authorization: Bearer <CRON_SECRET>" https://app.CLIENTE.com.br/api/cron/retomadas > /var/log/CLIENTE-retomadas.log 2>&1
# Prospecção — :00/:15/:30/:45
* * * * * root curl -sS -X POST -H "Authorization: Bearer <CRON_SECRET>" https://app.CLIENTE.com.br/api/cron/prospeccao > /var/log/CLIENTE-prospeccao.log 2>&1
* * * * * root sleep 15 && curl -sS -X POST -H "Authorization: Bearer <CRON_SECRET>" https://app.CLIENTE.com.br/api/cron/prospeccao > /var/log/CLIENTE-prospeccao.log 2>&1
* * * * * root sleep 30 && curl -sS -X POST -H "Authorization: Bearer <CRON_SECRET>" https://app.CLIENTE.com.br/api/cron/prospeccao > /var/log/CLIENTE-prospeccao.log 2>&1
* * * * * root sleep 45 && curl -sS -X POST -H "Authorization: Bearer <CRON_SECRET>" https://app.CLIENTE.com.br/api/cron/prospeccao > /var/log/CLIENTE-prospeccao.log 2>&1
```
> ⚠️ Garantir UMA cópia só (um `.bak` duplicado já fez o follow-up disparar 2x — ver [[project_followup_bugs_fix]]).

## Passo 9 — Conectar o WhatsApp + webhook  **[MANUAL]**
- Usar um chip **já aquecido** (passar pela incubadora/aquecedor antes — chip novo cru toma ban).
- No painel: tela de números → **Conectar (QR)**. Isso cria a instância na Evolution do cliente
  (nome = `DEFAULT_INSTANCE_NAME`) e a linha em `org_numeros`. Escanear o QR no celular.
- O webhook é configurado automaticamente pelo painel (`evolution-admin.ts` aponta pro
  `APP_BASE_URL/api/webhooks/evolution`). Conferir na Evolution que está `enabled` com
  `MESSAGES_UPSERT` + `CONNECTION_UPDATE`.

## Passo 10 — Configurar o Caio (conteúdo do cliente)  **[MANUAL via painel]**
No Admin do painel: **persona** (nome/voz), **prompt_system** (tom), **base de
conhecimento** (produtos/serviços/preços/diferenciais), **agenda** (dias/horários),
**cadência de follow-up e prospecção**, **critério de handoff**. É o que faz o Caio
"ser" do cliente.

## Validação (antes de ligar o tráfego)  **[MANUAL]**
- [ ] `https://app.CLIENTE.com.br/api/cron/followup` (GET) → `{"status":"ok"}`
- [ ] Webhook POST `{"event":"presence.update"}` → `{"ok":true}` (não 500 "tenant não configurado")
- [ ] Evolution `connectionState` = `open`
- [ ] Mandar 1 lead-fake de um número externo → Caio responde
- [ ] Esperar o 1º follow-up cair (nudge curto, sem duplicar)
- [ ] Relatório/handoff chegam no WhatsApp do admin do cliente

---

## Automação pendente (o que ainda dá pra tirar do "manual")
1. **`workflow_dispatch` com inputs** no `build-image.yml` (Supabase do cliente + tag) →
   build por cliente sem repo separado. (Passo 4-A.)
2. **Script de provisionamento** (Passo 2-3-5) — hoje é UI do EasyPanel; dá pra virar
   um `docker stack` versionado por cliente, mas o Supabase self-host é o trecho frágil.
3. **Seed por script** (Passo 7) — um `seed-cliente.sql` parametrizado + criação do admin.
4. **Aquecimento do chip** já é produto à parte (incubadora/aquecedor) — ver [[project_incubadora]].
