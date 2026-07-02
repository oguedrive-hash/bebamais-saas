"use client";

import { MidiaPicker } from "@/components/midia-picker";
import type { ProspeccaoRegra } from "../actions";

export function RegraCard({
  regra,
  idx,
  ehPrimeira,
  ehUltima,
  total,
  contexto = "cadencia",
  onChange,
  onRemove,
  onMoverCima,
  onMoverBaixo,
}: {
  regra: ProspeccaoRegra;
  idx: number;
  ehPrimeira: boolean;
  ehUltima: boolean;
  total: number;
  contexto?: "cadencia" | "followup";
  onChange: (patch: Partial<ProspeccaoRegra>) => void;
  onRemove: () => void;
  onMoverCima: () => void;
  onMoverBaixo: () => void;
}) {
  const referencia =
    contexto === "followup"
      ? ehPrimeira
        ? "lead parar de responder"
        : `follow-up nº${idx} ser enviado`
      : ehPrimeira
        ? "lead ser importado"
        : `mensagem nº${idx} ser enviada`;

  return (
    <div className="p-4 rounded-lg border border-cinza-claro bg-white">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-laranja text-white font-heading font-bold text-sm">
            {idx + 1}
          </span>
          <span className="text-sm font-heading font-semibold text-preto">
            Mensagem nº{idx + 1} de {total}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onMoverCima}
            disabled={ehPrimeira}
            className="p-1.5 text-cinza-medio hover:text-preto disabled:opacity-30 disabled:cursor-not-allowed transition"
            title="Mover pra cima"
          >
            ▲
          </button>
          <button
            type="button"
            onClick={onMoverBaixo}
            disabled={ehUltima}
            className="p-1.5 text-cinza-medio hover:text-preto disabled:opacity-30 disabled:cursor-not-allowed transition"
            title="Mover pra baixo"
          >
            ▼
          </button>
          <button
            type="button"
            onClick={onRemove}
            className="p-1.5 text-cinza-medio hover:text-red-600 transition"
            title="Remover"
          >
            ✕
          </button>
        </div>
      </div>

      <div className="mb-3">
        <label className="block text-[10px] font-heading font-semibold text-cinza-medio uppercase tracking-wider mb-1">
          Esperar após {referencia}
        </label>
        <div className="grid grid-cols-3 gap-2">
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={0}
              max={365}
              value={regra.esperar_dias}
              onChange={(e) =>
                onChange({ esperar_dias: parseInt(e.target.value, 10) || 0 })
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
              value={regra.esperar_horas}
              onChange={(e) =>
                onChange({ esperar_horas: parseInt(e.target.value, 10) || 0 })
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
              value={regra.esperar_minutos}
              onChange={(e) =>
                onChange({ esperar_minutos: parseInt(e.target.value, 10) || 0 })
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
          rows={3}
          value={regra.mensagem}
          onChange={(e) => onChange({ mensagem: e.target.value })}
          placeholder="Ex: Oi {nome}, sou da {empresa}. Vi que vocês atuam no segmento de..."
          className="w-full px-3 py-2 rounded-lg border border-cinza-claro bg-white text-preto placeholder:text-cinza-medio focus:outline-none focus:border-laranja transition text-sm"
        />
        <p className="text-[10px] text-cinza-medio mt-1">
          Use {"{nome}"} pra inserir o nome do lead. Outras colunas do CSV
          ficam disponíveis como {"{coluna}"} (ex: {"{empresa}"},{" "}
          {"{segmento}"}).
        </p>
      </div>

      <div className="flex items-center justify-end gap-3">
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
