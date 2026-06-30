#!/usr/bin/env node
/**
 * Seed de CLIENTE NOVO — cria a `organizations` + o login admin (auth user +
 * profile) no Supabase DO CLIENTE. Roda 1x no onboarding (Fase 3 da clonagem).
 *
 * As colunas de config (followup_config, voz, etc.) já têm DEFAULT no banco, então
 * aqui só semeamos o essencial: org (id/nome/email + prompt_system starter) e o
 * acesso do cliente ao painel. O resto (base de conhecimento, agenda, tom) o
 * cliente ajusta pela tela do painel.
 *
 * USO:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *   ORG_ID=<= DEFAULT_ORG_ID do painel> ORG_NAME="Cliente X" ORG_EMAIL=contato@x.com \
 *   ADMIN_EMAIL=admin@x.com ADMIN_PASSWORD='senhaForte' [ADMIN_NOME="Fulano"] \
 *   [PROMPT_SYSTEM="..."] \
 *   node scripts/seed-cliente.mjs [--dry-run]
 *
 * Idempotente: roda de novo sem duplicar (org/profile via upsert; user existente é reaproveitado).
 */

const DRY = process.argv.includes("--dry-run");
function need(k) {
  const v = process.env[k];
  if (!v || !String(v).trim()) {
    console.error(`✗ env obrigatória ausente: ${k}`);
    process.exit(1);
  }
  return String(v).trim();
}
const URL = need("SUPABASE_URL").replace(/\/+$/, "");
const KEY = need("SUPABASE_SERVICE_ROLE_KEY");
const ORG_ID = need("ORG_ID");
const ORG_NAME = need("ORG_NAME");
const ORG_EMAIL = need("ORG_EMAIL");
const ADMIN_EMAIL = need("ADMIN_EMAIL");
const ADMIN_PASSWORD = need("ADMIN_PASSWORD");
const ADMIN_NOME = (process.env.ADMIN_NOME ?? ORG_NAME).trim();
const PROMPT_SYSTEM =
  process.env.PROMPT_SYSTEM?.trim() ||
  `Você é o assistente de pré-vendas (SDR) da ${ORG_NAME}. Atende leads no WhatsApp: ` +
    `acolhe, entende a necessidade, qualifica e conduz pro próximo passo. Português do Brasil, ` +
    `tom humano e direto, mensagens curtas. (PROMPT STARTER — ajuste no painel com o tom e os ` +
    `produtos reais do cliente.)`;

const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };

async function call(method, path, body, extra = {}) {
  const res = await fetch(`${URL}${path}`, {
    method,
    headers: { ...H, ...extra },
    body: body ? JSON.stringify(body) : undefined,
  });
  const txt = await res.text();
  let data = null;
  try {
    data = txt ? JSON.parse(txt) : null;
  } catch {
    data = txt;
  }
  return { ok: res.ok, status: res.status, data };
}

async function main() {
  console.log(`\n== Seed cliente "${ORG_NAME}" em ${URL} ${DRY ? "(DRY-RUN)" : ""} ==`);

  // 1) ORG (upsert pelo id)
  const orgRow = {
    id: ORG_ID,
    name: ORG_NAME,
    email_contato: ORG_EMAIL,
    ativo: true,
    prompt_system: PROMPT_SYSTEM,
  };
  if (DRY) {
    console.log("• [dry] upsert organizations:", { ...orgRow, prompt_system: "<...>" });
  } else {
    const r = await call("POST", "/rest/v1/organizations", orgRow, {
      Prefer: "resolution=merge-duplicates,return=representation",
    });
    if (!r.ok) {
      console.error("✗ falha no upsert da org:", r.status, r.data);
      process.exit(2);
    }
    console.log("✓ organização criada/atualizada:", ORG_ID);
  }

  // 2) ADMIN auth user (cria; se já existir, acha)
  let userId = null;
  if (DRY) {
    console.log("• [dry] criaria auth user:", ADMIN_EMAIL);
  } else {
    const c = await call("POST", "/auth/v1/admin/users", {
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
      email_confirm: true,
    });
    if (c.ok && c.data?.id) {
      userId = c.data.id;
      console.log("✓ usuário admin criado:", ADMIN_EMAIL);
    } else {
      // já existe? procura pelo email
      const f = await call(
        "GET",
        `/auth/v1/admin/users?per_page=200`,
      );
      const u = (f.data?.users ?? f.data ?? []).find?.(
        (x) => (x.email ?? "").toLowerCase() === ADMIN_EMAIL.toLowerCase(),
      );
      if (u) {
        userId = u.id;
        console.log("• usuário admin já existia — reaproveitando:", ADMIN_EMAIL);
      } else {
        console.error("✗ não consegui criar nem achar o usuário admin:", c.status, c.data);
        process.exit(3);
      }
    }
  }

  // 3) PROFILE (liga o user à org como admin) — upsert pelo id
  if (DRY) {
    console.log("• [dry] upsert profile role=admin → org", ORG_ID);
  } else {
    const p = await call(
      "POST",
      "/rest/v1/profiles",
      { id: userId, organization_id: ORG_ID, nome: ADMIN_NOME, role: "admin" },
      { Prefer: "resolution=merge-duplicates,return=representation" },
    );
    if (!p.ok) {
      console.error("✗ falha no upsert do profile:", p.status, p.data);
      process.exit(4);
    }
    console.log("✓ profile admin vinculado à org");
  }

  console.log(
    `\n✅ Seed ${DRY ? "(dry-run) " : ""}ok. Login do painel: ${ADMIN_EMAIL}\n` +
      `   Próximo: conectar WhatsApp (QR) e configurar persona/base de conhecimento no painel.\n`,
  );
}

main().catch((e) => {
  console.error("✗ erro inesperado:", e?.message ?? e);
  process.exit(10);
});
