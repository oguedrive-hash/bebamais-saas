import { NextResponse, type NextRequest } from "next/server";
import { cronAutorizado } from "@/lib/seguranca";
import { enviarMensagensDeEspera } from "@/lib/atendimento/espera";

/** Rotina de 1 em 1 minuto: mensagem de espera para quem aguarda atendente. */
export async function POST(request: NextRequest) {
  if (!cronAutorizado(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const result = await enviarMensagensDeEspera();
  return NextResponse.json(result);
}
