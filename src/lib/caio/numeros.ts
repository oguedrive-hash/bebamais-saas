/**
 * Pool de números do atendente IA (tabela `org_numeros`).
 * Fase 1 da arquitetura multi-número (ver conhecimento/arquitetura-pool-numeros.md no cérebro).
 *
 * `numeroPorPapel` resolve o número ATIVO de um slot (atendimento/prospeccao/backup).
 * `instanciaDoLead` resolve qual número está SERVINDO um lead — com fallback que
 * NUNCA quebra: lead.evolution_instance -> número de atendimento -> número antigo da org.
 */
import { createAdminClient } from "@/lib/supabase/admin";

export type PapelNumero = "atendimento" | "prospeccao" | "backup";

export interface NumeroPool {
  instance_name: string;
  numero: string | null;
  persona_nome: string | null;
  persona_voice_id: string | null;
}

/** Número ativo do slot (menor prioridade primeiro). Null se a org não tem esse papel. */
export async function numeroPorPapel(
  orgId: string,
  papel: PapelNumero,
): Promise<NumeroPool | null> {
  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from("org_numeros")
      .select("instance_name, numero, persona_nome, persona_voice_id")
      .eq("organization_id", orgId)
      .eq("papel", papel)
      .eq("estado", "ativo")
      .eq("ativo", true)
      .order("prioridade", { ascending: true })
      .limit(1);
    return (data?.[0] as NumeroPool | undefined) ?? null;
  } catch {
    return null;
  }
}

/**
 * Persona (nome + voz) do número que está servindo o lead. Null se não achar
 * (aí o caller mantém o comportamento padrão da org). Usado pra Yasmin/Caio
 * falarem com a identidade certa conforme o número.
 */
export async function personaDoLead(
  evolutionInstanceDoLead: string | null,
): Promise<{ persona_nome: string | null; persona_voice_id: string | null } | null> {
  if (!evolutionInstanceDoLead) return null;
  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from("org_numeros")
      .select("persona_nome, persona_voice_id")
      .eq("instance_name", evolutionInstanceDoLead)
      .limit(1);
    return (
      (data?.[0] as { persona_nome: string | null; persona_voice_id: string | null } | undefined) ??
      null
    );
  } catch {
    return null;
  }
}

/**
 * Instância que serve um lead, com cascata de fallback:
 * 1) o número já carimbado no lead (`evolution_instance`);
 * 2) o número de atendimento da org;
 * 3) o `evolution_instance_name` legado da org (compat — Fase 1 não dropa esse campo).
 * Retorna null só se nada existir (org sem número nenhum).
 */
export async function instanciaDoLead(
  orgId: string,
  evolutionInstanceDoLead: string | null,
): Promise<string | null> {
  if (evolutionInstanceDoLead) return evolutionInstanceDoLead;
  const atend = await numeroPorPapel(orgId, "atendimento");
  if (atend?.instance_name) return atend.instance_name;
  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from("organizations")
      .select("evolution_instance_name")
      .eq("id", orgId)
      .limit(1);
    return (
      (data?.[0] as { evolution_instance_name?: string } | undefined)
        ?.evolution_instance_name ?? null
    );
  } catch {
    return null;
  }
}
