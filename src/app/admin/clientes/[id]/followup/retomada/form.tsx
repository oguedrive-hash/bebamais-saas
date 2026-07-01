"use client";

import { useState, useTransition } from "react";
import { MidiaPicker } from "@/components/midia-picker";
import {
  salvarFollowupConfig,
  type RetomadaConfig,
} from "../actions";

export function RetomadaForm({
  organizationId,
  retomadaInicial,
}: {
  organizationId: string;
  retomadaInicial: RetomadaConfig;
}) {
  const [retomada, setRetomada] = useState<RetomadaConfig>(retomadaInicial);
  const [pending, startTransition] = useTransition();
  const [salvouAgora, setSalvouAgora] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  function salvar() {
    setErro(null);
    startTransition(async () => {
      const result = await salvarFollowupConfig(organizationId, {
        retomada,
      });
      if ("error" in result) {
        setErro(result.error);
      } else {
        setSalvouAgora(true);
        setTimeout(() => setSalvouAgora(false), 3000);
      }
    });
  }

  return (
    <div className="space-y-6">
      <section>
        <div className="mb-3">
          <h3 className="text-base font-heading font-bold text-preto">
            Mensagem de retomada
          </h3>
          <p className="text-xs text-cinza-medio mt-1">
            Quando lead pede pra ser chamado em data específica (&quot;me chama
            amanhã às 14h&quot;), o Caio agenda automaticamente. Na hora
            combinada, dispara essa mensagem.
          </p>
        </div>

        <div className="space-y-4 p-4 rounded-lg bg-offwhite border border-cinza-claro">
          <MidiaPicker
            tipoMidia={retomada.tipo_midia ?? "texto"}
            attachmentUrl={retomada.attachment_url ?? null}
            attachmentMime={retomada.attachment_mime ?? null}
            onChangeTipo={(t) => setRetomada({ ...retomada, tipo_midia: t })}
            onAttachmentChange={(url, mime) =>
              setRetomada({
                ...retomada,
                attachment_url: url,
                attachment_mime: mime,
              })
            }
          />

          <div>
            <label className="block text-[10px] font-heading font-semibold text-cinza-medio uppercase tracking-wider mb-1">
              {retomada.tipo_midia === "audio"
                ? "Texto do áudio (vira voz via TTS)"
                : retomada.tipo_midia === "imagem" ||
                    retomada.tipo_midia === "video"
                  ? "Legenda da mídia"
                  : "Mensagem"}
            </label>
            <textarea
              rows={2}
              value={retomada.mensagem}
              onChange={(e) =>
                setRetomada({ ...retomada, mensagem: e.target.value })
              }
              placeholder="Ex: Oi {nome}! Como combinamos, voltando ao contato. Posso te ajudar a montar seu pedido?"
              className="w-full px-3 py-2 rounded-lg border border-cinza-claro bg-white text-preto placeholder:text-cinza-medio focus:outline-none focus:border-laranja transition text-sm"
            />
            <p className="text-[10px] text-cinza-medio mt-1">
              Use {"{nome}"} pra inserir o nome do lead.
            </p>
          </div>

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={retomada.usa_ia}
              onChange={(e) =>
                setRetomada({ ...retomada, usa_ia: e.target.checked })
              }
              className="w-4 h-4 rounded text-laranja focus:ring-laranja"
            />
            <span className="text-sm text-preto">
              Personalizar com IA (Caio adapta ao histórico)
            </span>
            <span className="text-[10px] text-cinza-medio ml-2">
              Recomendado deixar desligado pra mensagem ficar previsível
            </span>
          </label>
        </div>
      </section>

      {erro && (
        <div className="p-4 rounded-lg bg-red-50 border border-red-200">
          <p className="text-sm text-red-800">{erro}</p>
        </div>
      )}

      <div className="flex items-center gap-3 pt-4 border-t border-cinza-claro">
        <button
          type="button"
          onClick={salvar}
          disabled={pending}
          className="px-5 py-3 rounded-lg bg-laranja hover:bg-laranja-escuro disabled:bg-laranja-claro text-white font-heading font-semibold transition"
        >
          {pending ? "Salvando..." : "Salvar retomada"}
        </button>
        {salvouAgora && (
          <span className="text-sm text-green-700 font-heading font-semibold">
            ✓ Salvo
          </span>
        )}
      </div>
    </div>
  );
}
