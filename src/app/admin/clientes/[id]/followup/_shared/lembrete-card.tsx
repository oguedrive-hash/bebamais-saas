"use client";

import { MidiaPicker } from "@/components/midia-picker";
import type { LembreteReuniaoRegra } from "../actions";

export function LembreteCard({
  regra,
  idx,
  contexto,
  onChange,
  onRemove,
}: {
  regra: LembreteReuniaoRegra;
  idx: number;
  contexto: "antes" | "depois";
  onChange: (patch: Partial<LembreteReuniaoRegra>) => void;
  onRemove: () => void;
}) {
  const rotuloTempo =
    contexto === "antes" ? "Antes da retirada" : "Depois da retirada";

  return (
    <div className="p-4 rounded-lg border border-cinza-claro bg-white">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-laranja text-white font-heading font-bold text-sm">
            {idx + 1}
          </span>
          <span className="text-sm font-heading font-semibold text-preto">
            {contexto === "antes"
              ? `Lembrete nº${idx + 1}`
              : `Mensagem nº${idx + 1}`}
          </span>
        </div>
        <button
          type="button"
          onClick={onRemove}
          className="p-1.5 text-cinza-medio hover:text-red-600 transition"
          title="Remover"
        >
          ✕
        </button>
      </div>

      <div className="mb-3">
        <label className="block text-[10px] font-heading font-semibold text-cinza-medio uppercase tracking-wider mb-1">
          {rotuloTempo}
        </label>
        <div className="grid grid-cols-3 gap-2">
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={0}
              max={30}
              value={regra.tempo_dias}
              onChange={(e) =>
                onChange({ tempo_dias: parseInt(e.target.value, 10) || 0 })
              }
              className="w-full px-3 py-2 rounded-lg border border-cinza-claro bg-white text-preto focus:outline-none focus:border-laranja transition text-sm"
            />
            <span className="text-xs text-cinza-medio">dias</span>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={0}
              max={23}
              value={regra.tempo_horas}
              onChange={(e) =>
                onChange({ tempo_horas: parseInt(e.target.value, 10) || 0 })
              }
              className="w-full px-3 py-2 rounded-lg border border-cinza-claro bg-white text-preto focus:outline-none focus:border-laranja transition text-sm"
            />
            <span className="text-xs text-cinza-medio">h</span>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={0}
              max={59}
              value={regra.tempo_minutos}
              onChange={(e) =>
                onChange({ tempo_minutos: parseInt(e.target.value, 10) || 0 })
              }
              className="w-full px-3 py-2 rounded-lg border border-cinza-claro bg-white text-preto focus:outline-none focus:border-laranja transition text-sm"
            />
            <span className="text-xs text-cinza-medio">min</span>
          </div>
        </div>
      </div>

      <div className="mb-3">
        <MidiaPicker
          tipoMidia={regra.tipo_midia ?? "texto"}
          attachmentUrl={regra.attachment_url ?? null}
          attachmentMime={regra.attachment_mime ?? null}
          onChangeTipo={(t) => onChange({ tipo_midia: t })}
          onAttachmentChange={(url, mime) =>
            onChange({ attachment_url: url, attachment_mime: mime })
          }
        />
      </div>

      <div className="mb-3">
        <label className="block text-[10px] font-heading font-semibold text-cinza-medio uppercase tracking-wider mb-1">
          {regra.tipo_midia === "audio"
            ? "Texto do áudio (vira voz via TTS)"
            : regra.tipo_midia === "imagem" || regra.tipo_midia === "video"
              ? "Legenda da mídia"
              : "Mensagem"}
        </label>
        <textarea
          rows={2}
          value={regra.mensagem}
          onChange={(e) => onChange({ mensagem: e.target.value })}
          placeholder={
            contexto === "antes"
              ? "Ex: Oi {nome}, sua retirada é {data} às {hora}. Link: {meet_link}"
              : "Ex: E aí {nome}, como foi? Bora dar sequência?"
          }
          className="w-full px-3 py-2 rounded-lg border border-cinza-claro bg-white text-preto placeholder:text-cinza-medio focus:outline-none focus:border-laranja transition text-sm"
        />
      </div>

      <div className="flex items-center justify-between gap-3">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={regra.usa_ia}
            onChange={(e) => onChange({ usa_ia: e.target.checked })}
            className="w-4 h-4 rounded text-laranja focus:ring-laranja"
          />
          <span className="text-xs text-preto">Personalizar com IA</span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={regra.ativo}
            onChange={(e) => onChange({ ativo: e.target.checked })}
            className="w-4 h-4 rounded text-laranja focus:ring-laranja"
          />
          <span className="text-xs text-preto">Ativa</span>
        </label>
      </div>
    </div>
  );
}
