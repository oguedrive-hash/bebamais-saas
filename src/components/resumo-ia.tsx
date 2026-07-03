"use client";

import { useState, useTransition } from "react";
import { gerarResumoIA } from "@/app/dashboard/leads/[id]/actions";

export function ResumoIA({
  leadId,
  resumoInicial,
  geradoEm,
}: {
  leadId: string;
  resumoInicial: string | null;
  geradoEm: string | null;
}) {
  const [resumo, setResumo] = useState(resumoInicial);
  const [pending, startTransition] = useTransition();
  const [erro, setErro] = useState<string | null>(null);
  const [geradoEmLocal, setGeradoEmLocal] = useState(geradoEm);

  function onGerar() {
    setErro(null);
    const form = new FormData();
    form.set("leadId", leadId);
    startTransition(async () => {
      const result = await gerarResumoIA(form);
      if ("error" in result) {
        setErro(result.error);
        return;
      }
      setResumo(result.resumo);
      setGeradoEmLocal(new Date().toISOString());
    });
  }

  return (
    <div>
      {resumo ? (
        <div className="space-y-3">
          <div className="text-sm text-preto whitespace-pre-wrap leading-relaxed">
            <MarkdownBasico texto={resumo} />
          </div>
          <div className="flex items-center justify-between text-[10px] text-cinza-medio">
            <span>
              Gerado{" "}
              {geradoEmLocal ? formatRelativeDate(geradoEmLocal) : "agora"}
            </span>
            <button
              type="button"
              onClick={onGerar}
              disabled={pending}
              className="text-laranja hover:text-laranja-escuro font-heading font-semibold transition disabled:opacity-50"
            >
              {pending ? "Gerando..." : "Regenerar"}
            </button>
          </div>
        </div>
      ) : (
        <div>
          <button
            type="button"
            onClick={onGerar}
            disabled={pending}
            className="w-full px-3 py-2 bg-preto text-white text-xs font-heading font-semibold rounded-lg hover:opacity-90 transition disabled:opacity-50"
          >
            {pending ? "Gerando..." : "Gerar resumo IA"}
          </button>
        </div>
      )}

      {erro && (
        <p className="text-xs text-red-600 mt-2">{erro}</p>
      )}
    </div>
  );
}

/**
 * Renderiza um texto simples com suporte a **bold** (markdown básico).
 * Quebras de linha são preservadas via whitespace-pre-wrap no pai.
 */
function MarkdownBasico({ texto }: { texto: string }) {
  // Quebra em segmentos de **bold** e texto normal
  const partes = texto.split(/(\*\*[^*]+\*\*)/g);
  return (
    <>
      {partes.map((parte, i) => {
        if (parte.startsWith("**") && parte.endsWith("**")) {
          return (
            <strong key={i} className="font-heading font-semibold">
              {parte.slice(2, -2)}
            </strong>
          );
        }
        return <span key={i}>{parte}</span>;
      })}
    </>
  );
}

function formatRelativeDate(iso: string): string {
  const date = new Date(iso);
  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHrs = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffMin < 1) return "agora";
  if (diffMin < 60) return `${diffMin}min atrás`;
  if (diffHrs < 24) return `${diffHrs}h atrás`;
  if (diffDays < 7) return `${diffDays}d atrás`;
  return date.toLocaleDateString("pt-BR");
}
