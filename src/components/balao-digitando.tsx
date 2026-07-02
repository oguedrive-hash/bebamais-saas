"use client";

import { useEffect, useState } from "react";

/**
 * Renderiza o balão "IA está digitando..." quando processingSince é
 * recente (menos de 90s). Client-side only pra evitar hydration mismatch
 * com Date.now() — server renderiza nada, client decide dinamicamente.
 */
export function BalaoDigitando({
  processingSince,
}: {
  processingSince: string | null;
}) {
  const [ativo, setAtivo] = useState(false);

  useEffect(() => {
    if (!processingSince) {
      setAtivo(false);
      return;
    }
    const tick = () => {
      const age = Date.now() - new Date(processingSince).getTime();
      setAtivo(age < 90_000);
    };
    tick();
    const interval = setInterval(tick, 5000);
    return () => clearInterval(interval);
  }, [processingSince]);

  if (!ativo) return null;
  return (
    <div className="flex justify-end">
      <div className="max-w-[75%] px-4 py-3 rounded-2xl bg-laranja text-white">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-medium opacity-90">
            IA está digitando
          </span>
          <span className="flex gap-0.5">
            <span
              className="w-1 h-1 bg-white rounded-full animate-bounce"
              style={{ animationDelay: "0ms" }}
            />
            <span
              className="w-1 h-1 bg-white rounded-full animate-bounce"
              style={{ animationDelay: "150ms" }}
            />
            <span
              className="w-1 h-1 bg-white rounded-full animate-bounce"
              style={{ animationDelay: "300ms" }}
            />
          </span>
        </div>
      </div>
    </div>
  );
}
