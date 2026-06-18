/**
 * Teste da Evolution (F1 da migração Chatwoot→Evolution).
 * Manda um texto direto pelo WhatsApp via Evolution, SEM Chatwoot.
 *   POST /api/debug/evo-test
 *   Authorization: Bearer <CRON_SECRET>
 *   { "instance": "facilita", "telefone": "+5519998744971", "texto": "oi" }
 */
import { NextResponse, type NextRequest } from "next/server";
import { evoSendText } from "@/lib/caio/evolution-api";

export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET não configurado" }, { status: 500 });
  }
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { instance?: string; telefone?: string; texto?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "json inválido" }, { status: 400 });
  }
  const { instance, telefone, texto } = body;
  if (!instance || !telefone || !texto) {
    return NextResponse.json(
      { error: "instance, telefone e texto obrigatórios" },
      { status: 400 },
    );
  }
  const r = await evoSendText({ instance, telefone, texto });
  return NextResponse.json(r);
}
