# Clonagem do painel (Caio) para um novo cliente

Modelo: **cada cliente = VPS própria**, com painel + Evolution + Supabase + crons só dele.
A **imagem do painel é a mesma** (GHCR) — o que muda por cliente é **env + seed**.
A VPS da Facilita é a fábrica/lab onde a imagem é buildada.

> Status: **Fase 1 (parametrização) ✅ feita** — nenhum valor da Facilita fica
> hardcoded no código; `src/lib/caio/config.ts` exige as envs do tenant e
> `assertTenantConfig()` barra um clone mal-configurado. Fases 2-4 abaixo = TODO.

## Contrato de ENV por cliente

🔴 = obrigatória e **única por cliente** (nunca reaproveitar). 🟡 = **build-time**
(vai embutida na imagem via build-arg → cada cliente precisa do **build próprio**).
⚪ = compartilhável / tem default no código.

```bash
# Identidade do tenant (config.ts EXIGE — sem elas o painel barra)
DEFAULT_ORG_ID=            # 🔴 UUID da org (linha em `organizations`)
DEFAULT_INSTANCE_NAME=     # 🔴 nome da instância Evolution (ex: "cliente_x")
APP_BASE_URL=              # 🔴 URL pública do painel (sem barra final)
ADMIN_WHATSAPP_NUMBER=     # 🔴 WhatsApp do admin p/ alertas (ex: 5511999999999)

# Supabase do cliente
NEXT_PUBLIC_SUPABASE_URL=        # 🟡🔴 BUILD-TIME (precisa do build próprio)
NEXT_PUBLIC_SUPABASE_ANON_KEY=   # 🟡🔴 BUILD-TIME
SUPABASE_SERVICE_ROLE_KEY=       # 🔴 runtime

# Evolution do cliente
EVOLUTION_API_URL=         # 🔴
EVOLUTION_API_KEY=         # 🔴
EVOLUTION_RECEBE=1         # ⚪ 1 = processa inbound (produção)
EVOLUTION_ENVIO_TODOS=1    # ⚪
# EVOLUTION_ENVIO_TESTE=   # ⚪ número único p/ teste — REMOVER em produção

# OpenAI / ElevenLabs
OPENAI_API_KEY=            # 🔴
OPENAI_MODEL=gpt-4o-mini   # ⚪ (default no código)
OPENAI_WHISPER_MODEL=whisper-1   # ⚪
ELEVENLABS_API_KEY=        # ⚪ (compartilhável)
ELEVENLABS_VOICE_ID=       # ⚪ (voz da persona do cliente)

# Cron
CRON_SECRET=               # 🔴 gerar NOVO por cliente

TZ=America/Sao_Paulo       # ⚪
```

⚠️ **Caveat build-time:** `NEXT_PUBLIC_SUPABASE_URL/ANON_KEY` são embutidas na
imagem no `next build` (ver `.github/workflows/build-image.yml`). Como cada
cliente tem Supabase próprio, **cada cliente precisa de um build próprio** com
esses 2 build-args — não dá pra reusar 1 imagem só trocando env de runtime.
(Resolver na Fase 2.)

## Seed (dados no Supabase do cliente — não é env)

- `organizations`: 1 linha com `id = DEFAULT_ORG_ID`, `prompt_system` (tom/persona),
  `base_conhecimento`, `agenda_config`, `followup_config`, `prospeccao_followup_config`.
- `org_numeros`: o número de atendimento (instance = `DEFAULT_INSTANCE_NAME`).

## Roteiro (fases)

- **Fase 1 — Imagem clone-safe** ✅ parametrização (config.ts + assertTenantConfig).
- **Fase 2 — Empacotar o stack** ⬜ `docker-stack.yml` + build per-cliente (resolver o NEXT_PUBLIC build-time) que sobe painel+Evolution+Supabase+crons numa VPS nova.
- **Fase 3 — Onboarding (seed)** ⬜ script/tela pra semear org + persona + base + agenda + cadência; conectar WhatsApp (QR) + webhook.
- **Fase 4 — Runbook** ⬜ passo-a-passo "clonar cliente em N passos" + checklist de validação (WhatsApp open, webhook ok, Caio responde, follow-up dispara).

## Deploy da fábrica (referência)

Push no `master` → `build-image.yml` builda `ghcr.io/oguedrive-hash/facilita-painel:<sha>`
→ no VPS `docker service update --with-registry-auth --image ...:<sha> facilita_painel`.
