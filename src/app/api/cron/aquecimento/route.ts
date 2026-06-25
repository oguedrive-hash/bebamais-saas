import { NextResponse, type NextRequest } from "next/server";
import { processarAquecimento } from "@/lib/caio/aquecimento";

/**
 * Disparado pelo crontab no VPS — rode a cada 5 minutos.
 * Auth via header `Authorization: Bearer <CRON_SECRET>`.
 *
 * Crontab (cada 5 min), curl com timeout de 120s:
 *     curl -sS -m 120 -X POST -H "Authorization: Bearer SECRET" \
 *       https://app.facilitaplus.com.br/api/cron/aquecimento
 *
 * O worker já respeita horário humano (8h-22h BRT) e a rampa por número, então
 * pode rodar o dia todo — fora da janela ele só retorna sem fazer nada.
 */
export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "CRON_SECRET nao configurado" },
      { status: 500 },
    );
  }

  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await processarAquecimento();
  return NextResponse.json(result);
}

// GET opcional pra healthcheck (sem auth)
export async function GET() {
  return NextResponse.json({ status: "ok", endpoint: "/api/cron/aquecimento" });
}
