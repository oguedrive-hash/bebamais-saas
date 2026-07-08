"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { importarProdutosPlanilha } from "./actions";

/**
 * Importação do catálogo por planilha (.xlsx/.xls/.csv) — parse no browser
 * (SheetJS, import dinâmico pra não pesar o bundle da página), prévia, e
 * upsert por código no servidor. Detecta as colunas por heurística no
 * cabeçalho ("refer..." e "descri.../produto/item"); sem cabeçalho, usa as
 * duas primeiras colunas.
 */

type LinhaImport = { codigo: string; descricao: string };

function detectarColunas(matriz: unknown[][]): {
  linhas: LinhaImport[];
  aviso: string | null;
} {
  if (matriz.length === 0) return { linhas: [], aviso: null };
  const cab = (matriz[0] ?? []).map((c) =>
    String(c ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, ""),
  );
  let iCod = cab.findIndex((c) => /refer|codigo|cod\b|ref\b/.test(c));
  let iDesc = cab.findIndex((c) => /descri|produto|item|nome/.test(c));
  let inicio = 1;
  let aviso: string | null = null;
  if (iCod === -1 || iDesc === -1 || iCod === iDesc) {
    iCod = 0;
    iDesc = 1;
    inicio = 0;
    aviso =
      "Não achei cabeçalho de Referência/Descrição — usando as duas primeiras colunas.";
  }
  const linhas: LinhaImport[] = [];
  for (const row of matriz.slice(inicio)) {
    const codigo = String(row?.[iCod] ?? "").trim();
    const descricao = String(row?.[iDesc] ?? "").trim();
    if (!codigo && !descricao) continue;
    linhas.push({ codigo, descricao });
  }
  return { linhas, aviso };
}

export function BotaoImportarPlanilha() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [aberto, setAberto] = useState(false);
  const [linhas, setLinhas] = useState<LinhaImport[]>([]);
  const [avisoColunas, setAvisoColunas] = useState<string | null>(null);
  const [marcarAusentes, setMarcarAusentes] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [resultado, setResultado] = useState<string | null>(null);
  const [lendo, setLendo] = useState(false);
  const [pending, startTransition] = useTransition();

  async function lerArquivo(file: File) {
    setErro(null);
    setResultado(null);
    setLendo(true);
    try {
      const XLSX = await import("xlsx");
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const matriz = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
        header: 1,
        raw: false,
      });
      const { linhas: parsed, aviso } = detectarColunas(matriz);
      if (parsed.length === 0) {
        setErro("Nenhuma linha aproveitável na planilha.");
        setLinhas([]);
      } else {
        setLinhas(parsed);
        setAvisoColunas(aviso);
      }
    } catch (e) {
      setErro(
        "Não consegui ler o arquivo — confere se é .xlsx/.xls/.csv válido. " +
          (e instanceof Error ? e.message : ""),
      );
      setLinhas([]);
    } finally {
      setLendo(false);
    }
  }

  function importar() {
    if (pending || linhas.length === 0) return;
    setErro(null);
    startTransition(async () => {
      try {
        const validas = linhas.filter((l) => l.codigo.trim() && l.descricao.trim());
        const r = await importarProdutosPlanilha(validas, {
          marcarAusentesEmFalta: marcarAusentes,
        });
        if ("error" in r) {
          setErro(r.error);
          return;
        }
        setResultado(
          `Importado! ${r.inseridos} novo${r.inseridos !== 1 ? "s" : ""}, ${r.atualizados} atualizado${r.atualizados !== 1 ? "s" : ""}` +
            (r.marcadosEmFalta > 0 ? `, ${r.marcadosEmFalta} marcados em falta` : "") +
            (r.invalidos > 0 ? ` (${r.invalidos} linhas ignoradas)` : "") +
            ".",
        );
        setLinhas([]);
        if (inputRef.current) inputRef.current.value = "";
        router.refresh();
      } catch {
        setErro("Falha de conexão — tente de novo.");
      }
    });
  }

  function fechar() {
    if (pending) return;
    setAberto(false);
    setLinhas([]);
    setErro(null);
    setResultado(null);
    setAvisoColunas(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setAberto(true)}
        className="px-4 py-2.5 rounded-lg border border-cinza-claro bg-white text-preto hover:border-laranja hover:text-laranja text-sm font-heading font-semibold transition"
      >
        ⬆ Importar planilha
      </button>

      {aberto && (
        <div
          className="fixed inset-0 z-50 bg-preto/40 flex items-center justify-center p-4 overflow-y-auto"
          onClick={fechar}
        >
          <div
            className="bg-white rounded-2xl border border-cinza-claro p-6 w-full max-w-lg shadow-xl max-h-[90vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-heading font-bold text-preto mb-1">
              Importar planilha de produtos
            </h2>
            <p className="text-xs text-cinza-medio mb-4">
              .xlsx, .xls ou .csv com colunas de <strong>Referência</strong> e{" "}
              <strong>Descrição</strong>. Código existente atualiza a
              descrição; código novo entra no catálogo.
            </p>

            <input
              ref={inputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void lerArquivo(f);
              }}
              className="block w-full text-xs text-cinza-medio file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border file:border-cinza-claro file:bg-white file:text-preto file:font-heading file:font-semibold file:text-xs hover:file:border-laranja cursor-pointer mb-3"
            />
            {lendo && <p className="text-xs text-cinza-medio mb-2">Lendo…</p>}
            {avisoColunas && (
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-2">
                {avisoColunas}
              </p>
            )}

            {linhas.length > 0 && (
              <>
                <div className="flex-1 min-h-0 overflow-auto border border-cinza-claro rounded-lg mb-3">
                  <table className="w-full text-xs">
                    <thead className="bg-offwhite sticky top-0">
                      <tr>
                        <th className="text-left p-2 font-heading w-24">Código</th>
                        <th className="text-left p-2 font-heading">Descrição</th>
                      </tr>
                    </thead>
                    <tbody>
                      {linhas.slice(0, 30).map((l, i) => (
                        <tr key={i} className="border-t border-cinza-claro">
                          <td className="p-2 font-mono">{l.codigo}</td>
                          <td className="p-2">{l.descricao}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {linhas.length > 30 && (
                    <p className="p-2 text-[10px] text-cinza-medio text-center">
                      …e mais {linhas.length - 30} linhas
                    </p>
                  )}
                </div>
                <label className="flex items-center gap-2 text-xs text-preto mb-3 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={marcarAusentes}
                    onChange={(e) => setMarcarAusentes(e.target.checked)}
                    className="w-4 h-4 accent-laranja"
                  />
                  Marcar como <strong>em falta</strong> os produtos do catálogo
                  que não estão nesta planilha
                </label>
              </>
            )}

            {erro && (
              <p className="text-sm text-red-800 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-3">
                {erro}
              </p>
            )}
            {resultado && (
              <p className="text-sm text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 mb-3">
                {resultado}
              </p>
            )}

            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={fechar}
                disabled={pending}
                className="px-4 py-2 rounded-lg border border-cinza-claro text-sm font-heading font-semibold text-cinza-medio hover:text-preto transition"
              >
                Fechar
              </button>
              <button
                type="button"
                onClick={importar}
                disabled={pending || linhas.length === 0}
                className="px-4 py-2 rounded-lg bg-laranja hover:bg-laranja-escuro text-white text-sm font-heading font-semibold disabled:opacity-50 transition"
              >
                {pending
                  ? "Importando…"
                  : `Importar ${linhas.length} linha${linhas.length !== 1 ? "s" : ""}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
