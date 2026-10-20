import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { calcularPadroes, type MensagemCaptada } from "@/lib/aprendizado/padroes";
import { TelaAprendizado } from "./tela";

export const dynamic = "force-dynamic";

/** Quantas mensagens recentes entram no cálculo dos padrões (páginas de 1000). */
const PAGINAS_PADROES = 6;

function diasDesde(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
}

async function mensagensRecentes(orgId: string): Promise<MensagemCaptada[]> {
  const admin = createAdminClient();
  const paginas = await Promise.all(
    Array.from({ length: PAGINAS_PADROES }, (_, i) =>
      admin
        .from("aprendizado_mensagens")
        .select("conversa_jid, direcao, tipo, conteudo, enviada_em")
        .eq("organization_id", orgId)
        .order("enviada_em", { ascending: false })
        .range(i * 1000, i * 1000 + 999),
    ),
  );
  return paginas.flatMap((p) => (p.data ?? []) as MensagemCaptada[]);
}

/**
 * APRENDIZADO: o WhatsApp de maior movimento da loja fica conectado só para ler.
 * As conversas reais viram a base para ajustar as informações da loja e o jeito
 * do assistente falar. Ver src/lib/aprendizado/captura.ts.
 */
export default async function AprendizadoPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ c?: string }>;
}) {
  const { id } = await params;
  const { c: conversaAberta } = await searchParams;
  const admin = createAdminClient();

  const { data: org } = await admin.from("organizations").select("id").eq("id", id).maybeSingle();
  if (!org) notFound();

  const [{ data: cfg }, { count: total }, { count: daEquipe }, { data: primeira }, { data: ultima }, { data: conversas }, recentes] =
    await Promise.all([
      admin
        .from("aprendizado_config")
        .select("instance_name, status_conexao, numero, conectado_em, historico_importado_em")
        .eq("organization_id", id)
        .maybeSingle(),
      admin.from("aprendizado_mensagens").select("id", { count: "exact", head: true }).eq("organization_id", id),
      admin.from("aprendizado_mensagens").select("id", { count: "exact", head: true }).eq("organization_id", id).eq("direcao", "equipe"),
      admin.from("aprendizado_mensagens").select("enviada_em").eq("organization_id", id).order("enviada_em", { ascending: true }).limit(1).maybeSingle(),
      admin.from("aprendizado_mensagens").select("enviada_em").eq("organization_id", id).order("enviada_em", { ascending: false }).limit(1).maybeSingle(),
      admin
        .from("aprendizado_conversas")
        .select("conversa_jid, nome_contato, telefone, mensagens, da_equipe, ultima")
        .eq("organization_id", id)
        .order("ultima", { ascending: false })
        .limit(150),
      mensagensRecentes(id),
    ]);

  const { data: mensagens } = conversaAberta
    ? await admin
        .from("aprendizado_mensagens")
        .select("id, direcao, tipo, conteudo, enviada_em")
        .eq("organization_id", id)
        .eq("conversa_jid", conversaAberta)
        .order("enviada_em", { ascending: true })
        .limit(500)
    : { data: null };

  return (
    <TelaAprendizado
      id={id}
      cfg={cfg}
      total={total}
      daEquipe={daEquipe}
      primeira={primeira}
      ultima={ultima}
      conversas={conversas}
      conversaAberta={conversaAberta}
      mensagens={mensagens}
      padroes={calcularPadroes(recentes)}
      diasCaptando={cfg?.conectado_em ? diasDesde(cfg.conectado_em) : 0}
    />
  );
}
