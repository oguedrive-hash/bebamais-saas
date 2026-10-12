# Instalação

Arquitetura recomendada:
- uma VPS só para o Beba Mais, com o painel e a Evolution;
- o banco de dados no Supabase em nuvem.

## 1. Supabase

1. Crie um projeto em supabase.com, na região São Paulo.
2. Em **SQL Editor**, rode os arquivos de `supabase/migrations/` em ordem (`0001` até o último). Se preferir pelo terminal:
   ```bash
   for f in supabase/migrations/0*.sql; do psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$f"; done
   ```
3. Em **Authentication → Providers**, deixe o cadastro público **desligado** (Allow new users to sign up = off). Quem cria as atendentes é o administrador, pelo painel.
4. Anote os valores de **Project Settings → API**: URL, `anon key` e `service_role key`.
5. Crie a empresa e o primeiro administrador:
   ```bash
   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
   ORG_ID=$(uuidgen) ORG_NAME="Beba Mais Distribuidora" ORG_EMAIL=contato@bebamais.com.br \
   ADMIN_EMAIL=admin@usuarios.bebamais.local ADMIN_PASSWORD='senha-forte' ADMIN_NOME="Administrador" \
   node scripts/seed-cliente.mjs
   ```
   Guarde o `ORG_ID`: ele é o `DEFAULT_ORG_ID`.

## 2. Imagem do painel

No GitHub, vá em **Actions → build-image → Run workflow** e informe o endereço e a `anon key` do Supabase. Isso gera a imagem `ghcr.io/oguedrive-hash/bebamais-painel`.

## 3. VPS

Configuração sugerida: Ubuntu, 2 vCPU e 4 GB de RAM, com Docker e Docker Compose.

1. **Segurança da máquina:**
   - firewall liberando só as portas 22, 80 e 443 (`ufw allow 22,80,443/tcp && ufw enable`);
   - acesso SSH só por chave, sem senha;
   - atualizações automáticas (`unattended-upgrades`).
2. **DNS:** aponte o domínio do painel (ex.: `atendimento.bebamais.com.br`) para o IP da VPS.
3. **Variáveis e subida:**
   ```bash
   cp deploy/env.cliente.example deploy/.env.cliente   # preencher; gerar segredos com: openssl rand -hex 32
   docker login ghcr.io
   docker compose --env-file deploy/.env.cliente -f deploy/docker-compose.cliente.yml up -d
   ```
   A Evolution não fica exposta na internet. Só o painel tem endereço público, com HTTPS automático.

## 4. Primeiro acesso

1. Entre no painel com o administrador e abra **Configurações**.
2. **Assistente:** preencha as informações da loja, os horários e as respostas prontas.
3. **Números:** adicione cada número de WhatsApp e leia o QR Code com o celular do número.
   - Para testar, coloque os telefones de teste no **Modo teste**, assim o assistente só responde a eles.
   - Use um número que não seja o oficial da loja até tudo estar aprovado.
4. **Atendentes:** crie o login de cada atendente.

## Atualizar

1. Gere a imagem nova (passo 2).
2. Rode as migrações novas no Supabase.
3. Na VPS, atualize o painel:
   ```bash
   docker compose --env-file deploy/.env.cliente -f deploy/docker-compose.cliente.yml pull painel
   docker compose --env-file deploy/.env.cliente -f deploy/docker-compose.cliente.yml up -d painel
   ```

Se trocar o `WEBHOOK_SECRET`, abra **Números** e clique em **Reconfigurar conexão** em cada número.
