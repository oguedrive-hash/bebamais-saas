/**
 * Webhook da Evolution: toda mensagem que chega (ou sai pelo celular) nos
 * números de WhatsApp conectados passa por aqui.
 *
 * Autenticação: token na URL (?token=WEBHOOK_SECRET), configurado
 * automaticamente quando o número é conectado pelo painel. Sem token certo,
 * nada é processado — ninguém de fora consegue injetar mensagens falsas.
 */
import { NextResponse, type NextRequest, after } from "next/server";
import { assertTenantConfig, ORG_ID } from "@/lib/caio/config";
import { webhookAutorizado } from "@/lib/seguranca";
import { atualizarConexao, processarMensagem, type EvoMensagem } from "@/lib/atendimento/inbound";
import { grupoDaMensagem, processarMensagemDeGrupo } from "@/lib/atendimento/grupos";
import {
  atualizarConexaoAprendizado,
  ehInstanciaAprendizado,
  registrarMensagemAprendizado,
  type MensagemEvo,
} from "@/lib/aprendizado/captura";

export async function POST(request: NextRequest) {
  if (!webhookAutorizado(request.nextUrl.searchParams.get("token"))) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  try {
    assertTenantConfig();
  } catch (e) {
    console.error("[webhook:evolution]", e instanceof Error ? e.message : e);
    return NextResponse.json({ ok: false }, { status: 500 });
  }

  let body: { event?: string; instance?: string; data?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  const instance = typeof body.instance === "string" ? body.instance : "";
  if (!instance) return NextResponse.json({ ok: true });
  const evento = (body.event ?? "").toLowerCase().replace(/_/g, ".");
  const lista = Array.isArray(body.data) ? body.data : [body.data];

  // APRENDIZADO: o WhatsApp da loja conectado só para LER. Desvia ANTES de tudo:
  // nada daqui vira cliente, e o assistente nunca responde. Ver lib/aprendizado.
  if (ehInstanciaAprendizado(instance)) {
    if (evento === "connection.update") {
      const conn = body.data as { state?: string; wuid?: string } | undefined;
      after(() =>
        atualizarConexaoAprendizado(ORG_ID, instance, conn?.state ?? "", conn?.wuid ?? null).catch((e) =>
          console.error("[aprendizado] conexão:", e),
        ),
      );
    } else if (evento === "messages.upsert") {
      for (const d of lista) {
        after(() =>
          registrarMensagemAprendizado(d as MensagemEvo, ORG_ID, instance).catch((e) =>
            console.error("[aprendizado] mensagem:", e),
          ),
        );
      }
    }
    return NextResponse.json({ ok: true });
  }

  if (evento === "connection.update") {
    const estado = (body.data as { state?: string } | undefined)?.state ?? "";
    after(() => atualizarConexao(instance, estado).catch(() => {}));
    return NextResponse.json({ ok: true });
  }

  if (evento === "messages.upsert") {
    // Responde 200 na hora e processa em segundo plano (baixar foto, transcrever
    // áudio e esperar o cliente terminar de digitar levam alguns segundos; se o
    // webhook demorar, a Evolution acha que falhou e reenvia).
    for (const d of lista) {
      const msg = d as EvoMensagem;
      // Grupo vai para a aba "Grupos": o assistente nunca responde em grupo.
      const processar = grupoDaMensagem(msg?.key) ? processarMensagemDeGrupo : processarMensagem;
      after(() =>
        processar(instance, msg).catch((e) => console.error("[webhook:evolution] erro:", e)),
      );
    }
  }
  return NextResponse.json({ ok: true });
}
