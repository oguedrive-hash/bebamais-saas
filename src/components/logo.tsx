/**
 * Logo da Beba Mais (PNG com fundo transparente, já recortado — 633x192 ≈ 3.3:1).
 * Só há a versão colorida (vermelho + dourado). `variant` é mantido por compat
 * com as chamadas antigas, mas usa o mesmo arquivo nos dois casos.
 * Default h-8 (~32px); width/height setados pra evitar layout shift.
 */
export function Logo({
  className = "",
}: {
  className?: string;
  /** @deprecated mantido por compat com chamadas antigas */
  showPlus?: boolean;
  /** @deprecated só há uma versão do logo; mantido por compat */
  variant?: "dark" | "light";
}) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/logo-bebamais-trim.png"
      alt="Beba Mais"
      width={106}
      height={32}
      className={`h-8 w-auto select-none ${className}`}
      draggable={false}
    />
  );
}
