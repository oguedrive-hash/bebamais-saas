"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { invalidarCatalogo } from "@/lib/caio/catalogo";

/**
 * CRUD do catálogo de produtos. Padrão do projeto: valida acesso com o client
 * do usuário (org via profiles), escreve via service role.
 */

async function orgDoUsuario(): Promise<{ orgId: string } | { error: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Não autenticado" };
  const { data: profile } = await supabase
    .from("profiles")
    .select("organization_id")
    .eq("id", user.id)
    .single();
  if (!profile?.organization_id) return { error: "Sem organização vinculada" };
  return { orgId: profile.organization_id as string };
}

function validar(codigoRef: string, descricao: string): string | null {
  if (!codigoRef.trim()) return "Informe o código de referência";
  if (codigoRef.trim().length > 20) return "Código muito longo (máx 20)";
  if (!descricao.trim()) return "Informe a descrição";
  if (descricao.trim().length > 200) return "Descrição muito longa (máx 200)";
  return null;
}

/** "litrão, seiscentos" → ["litrao","seiscentos"] (minúsculo, sem acento, máx 5) */
function parseApelidos(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  return [
    ...new Set(
      raw
        .split(",")
        .map((a) =>
          a
            .trim()
            .toLowerCase()
            .normalize("NFD")
            .replace(/[̀-ͯ]/g, "")
            .slice(0, 30),
        )
        .filter(Boolean),
    ),
  ].slice(0, 5);
}

export async function criarProduto(input: {
  codigoRef: string;
  descricao: string;
  apelidos?: string;
  categoria?: string;
}): Promise<{ ok: true } | { error: string }> {
  const ctx = await orgDoUsuario();
  if ("error" in ctx) return ctx;
  const invalido = validar(input.codigoRef, input.descricao);
  if (invalido) return { error: invalido };

  const admin = createAdminClient();
  const { error } = await admin.from("produtos").insert({
    organization_id: ctx.orgId,
    codigo_ref: input.codigoRef.trim().toUpperCase(),
    descricao: input.descricao.trim(),
    apelidos: parseApelidos(input.apelidos),
    categoria: input.categoria?.trim() || null,
  });
  if (error) {
    if (error.code === "23505") {
      // Pode ser um produto REMOVIDO (ativo=false) com o mesmo código — reativa.
      const { data: reativado, error: errReativa } = await admin
        .from("produtos")
        .update({
          ativo: true,
          disponivel: true,
          descricao: input.descricao.trim(),
        })
        .eq("organization_id", ctx.orgId)
        .eq("codigo_ref", input.codigoRef.trim().toUpperCase())
        .eq("ativo", false)
        .select("id")
        .maybeSingle();
      if (errReativa) return { error: errReativa.message };
      if (reativado) {
        invalidarCatalogo(ctx.orgId);
  revalidatePath("/dashboard/produtos");
        return { ok: true };
      }
      return { error: `Já existe um produto com o código ${input.codigoRef.trim().toUpperCase()}` };
    }
    return { error: error.message };
  }
  invalidarCatalogo(ctx.orgId);
  revalidatePath("/dashboard/produtos");
  return { ok: true };
}

export async function atualizarProduto(
  id: string,
  input: {
    codigoRef: string;
    descricao: string;
    apelidos?: string;
    categoria?: string;
  },
): Promise<{ ok: true } | { error: string }> {
  const ctx = await orgDoUsuario();
  if ("error" in ctx) return ctx;
  const invalido = validar(input.codigoRef, input.descricao);
  if (invalido) return { error: invalido };

  const admin = createAdminClient();
  const { data: linha, error } = await admin
    .from("produtos")
    .update({
      codigo_ref: input.codigoRef.trim().toUpperCase(),
      descricao: input.descricao.trim(),
      ...(input.apelidos !== undefined
        ? { apelidos: parseApelidos(input.apelidos) }
        : {}),
      ...(input.categoria !== undefined
        ? { categoria: input.categoria.trim() || null }
        : {}),
    })
    .eq("id", id)
    .eq("organization_id", ctx.orgId)
    .eq("ativo", true) // não edita produto já removido por outro atendente
    .select("id")
    .maybeSingle();
  if (error) {
    if (error.code === "23505")
      return { error: `Já existe um produto com o código ${input.codigoRef.trim().toUpperCase()}` };
    return { error: error.message };
  }
  if (!linha) return { error: "Produto não encontrado" };
  invalidarCatalogo(ctx.orgId);
  revalidatePath("/dashboard/produtos");
  return { ok: true };
}

export async function setDisponivel(
  id: string,
  disponivel: boolean,
): Promise<{ ok: true } | { error: string }> {
  const ctx = await orgDoUsuario();
  if ("error" in ctx) return ctx;
  const admin = createAdminClient();
  const { data: linha, error } = await admin
    .from("produtos")
    .update({ disponivel })
    .eq("id", id)
    .eq("organization_id", ctx.orgId)
    .eq("ativo", true) // não alterna produto já removido
    .select("id")
    .maybeSingle();
  if (error) return { error: error.message };
  if (!linha) return { error: "Produto não encontrado" };
  invalidarCatalogo(ctx.orgId);
  revalidatePath("/dashboard/produtos");
  return { ok: true };
}

/** Busca leve pro autocomplete (edição de item do pedido).
 *  Filtro de org explícito: a RLS libera tudo pra admin (is_admin), então sem
 *  o filtro um admin veria catálogos de outras orgs misturados. */
export async function buscarProdutosAtivos(
  termo: string,
): Promise<{ codigo_ref: string; descricao: string }[]> {
  if (termo.trim().length < 2) return [];
  const ctx = await orgDoUsuario();
  if ("error" in ctx) return [];
  const supabase = await createClient();
  const palavras = termo
    .split(/\s+/)
    .map((w) => w.replace(/[%_*\\]/g, ""))
    .filter(Boolean);
  if (palavras.length === 0) return [];

  let query = supabase
    .from("produtos")
    .select("codigo_ref, descricao")
    .eq("organization_id", ctx.orgId)
    .eq("ativo", true)
    .eq("disponivel", true)
    .order("descricao")
    .limit(20);
  if (palavras.length === 1 && !/[,()]/.test(palavras[0])) {
    query = query.or(
      `descricao.ilike.%${palavras[0]}%,codigo_ref.ilike.%${palavras[0]}%`,
    );
  } else {
    for (const w of palavras) query = query.ilike("descricao", `%${w}%`);
  }
  const { data } = await query;
  // Quem COMEÇA com o termo vem primeiro ("bra" → Brahma antes de "Cobra")
  const t = palavras[0].toLowerCase();
  return (data ?? [])
    .sort((a, b) => {
      const pa = a.descricao.toLowerCase().startsWith(t) ? 0 : 1;
      const pb = b.descricao.toLowerCase().startsWith(t) ? 0 : 1;
      return pa - pb || a.descricao.localeCompare(b.descricao);
    })
    .slice(0, 8);
}

/** Marca vários produtos como em falta/disponível de uma vez (seleção em lote). */
export async function setDisponivelLote(
  ids: string[],
  disponivel: boolean,
): Promise<{ ok: true; alterados: number } | { error: string }> {
  const ctx = await orgDoUsuario();
  if ("error" in ctx) return ctx;
  if (!Array.isArray(ids) || ids.length === 0) return { error: "Nada selecionado" };
  if (ids.length > 200) return { error: "Máximo de 200 por vez" };
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("produtos")
    .update({ disponivel })
    .in("id", ids)
    .eq("organization_id", ctx.orgId)
    .eq("ativo", true)
    .select("id");
  if (error) return { error: error.message };
  invalidarCatalogo(ctx.orgId);
  revalidatePath("/dashboard/produtos");
  return { ok: true, alterados: (data ?? []).length };
}

/**
 * Importa/atualiza o catálogo a partir de planilha (parse é no browser; aqui
 * chegam linhas {codigo, descricao} já extraídas). Upsert por código:
 * existente atualiza a descrição (e reativa se estava removido), novo insere.
 * `marcarAusentesEmFalta`: produto ativo que NÃO está na planilha vira
 * "em falta" (não remove — histórico/pedidos antigos continuam válidos).
 */
export async function importarProdutosPlanilha(
  linhas: { codigo: string; descricao: string }[],
  opts?: { marcarAusentesEmFalta?: boolean },
): Promise<
  | {
      ok: true;
      inseridos: number;
      atualizados: number;
      invalidos: number;
      marcadosEmFalta: number;
    }
  | { error: string }
> {
  const ctx = await orgDoUsuario();
  if ("error" in ctx) return ctx;
  if (!Array.isArray(linhas) || linhas.length === 0) {
    return { error: "Planilha vazia" };
  }
  if (linhas.length > 3000) return { error: "Máximo de 3000 linhas por importação" };

  const admin = createAdminClient();
  const { data: existentes } = await admin
    .from("produtos")
    .select("id, codigo_ref, ativo")
    .eq("organization_id", ctx.orgId)
    .limit(5000);
  const porCodigo = new Map(
    (existentes ?? []).map((p) => [p.codigo_ref as string, p]),
  );

  let inseridos = 0;
  let atualizados = 0;
  let invalidos = 0;
  const codigosPlanilha = new Set<string>();

  for (const l of linhas) {
    const codigo = String(l.codigo ?? "").trim().toUpperCase().slice(0, 20);
    const descricao = String(l.descricao ?? "").trim().slice(0, 200);
    if (!codigo || !descricao) {
      invalidos++;
      continue;
    }
    // Dedup dentro da própria planilha (última ocorrência vence)
    codigosPlanilha.add(codigo);
    const exist = porCodigo.get(codigo);
    if (exist) {
      const { error } = await admin
        .from("produtos")
        .update({ descricao, ativo: true, disponivel: true })
        .eq("id", exist.id);
      if (!error) atualizados++;
      else invalidos++;
    } else {
      const { error } = await admin.from("produtos").insert({
        organization_id: ctx.orgId,
        codigo_ref: codigo,
        descricao,
      });
      if (!error) inseridos++;
      else invalidos++;
    }
  }

  let marcadosEmFalta = 0;
  if (opts?.marcarAusentesEmFalta) {
    const ausentes = (existentes ?? [])
      .filter((p) => p.ativo && !codigosPlanilha.has(p.codigo_ref as string))
      .map((p) => p.id as string);
    for (let i = 0; i < ausentes.length; i += 100) {
      const chunk = ausentes.slice(i, i + 100);
      const { data } = await admin
        .from("produtos")
        .update({ disponivel: false })
        .in("id", chunk)
        .eq("organization_id", ctx.orgId)
        .select("id");
      marcadosEmFalta += (data ?? []).length;
    }
  }

  invalidarCatalogo(ctx.orgId);
  revalidatePath("/dashboard/produtos");
  return { ok: true, inseridos, atualizados, invalidos, marcadosEmFalta };
}

export async function removerProduto(
  id: string,
): Promise<{ ok: true } | { error: string }> {
  const ctx = await orgDoUsuario();
  if ("error" in ctx) return ctx;
  const admin = createAdminClient();
  // Soft delete: sai do catálogo mas fica no banco (histórico/reativação)
  const { data: linha, error } = await admin
    .from("produtos")
    .update({ ativo: false })
    .eq("id", id)
    .eq("organization_id", ctx.orgId)
    .select("id")
    .maybeSingle();
  if (error) return { error: error.message };
  if (!linha) return { error: "Produto não encontrado" };
  invalidarCatalogo(ctx.orgId);
  revalidatePath("/dashboard/produtos");
  return { ok: true };
}
