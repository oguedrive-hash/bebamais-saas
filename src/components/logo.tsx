/**
 * Logo da Beba Mais — versao oficial (PNG do manual da marca).
 *
 * `variant="dark"` (default) — pra fundos claros (creme/branco). Plus laranja + texto preto.
 * `variant="light"` — pra fundos escuros. Tudo branco.
 *
 * Largura calculada do aspect ratio original (1488x384 ≈ 3.875:1) pra evitar
 * layout shift. Default h-8 (~32px) replica a visualidade do antigo `text-2xl`.
 */
export function Logo({
  className = "",
  variant = "dark",
}: {
  className?: string;
  /** @deprecated mantido por compat com chamadas antigas */
  showPlus?: boolean;
  variant?: "dark" | "light";
}) {
  const src =
    variant === "light"
      ? "/logo-facilita-plus-white.png"
      : "/logo-facilita-plus.png";

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt="Beba Mais"
      width={124}
      height={32}
      className={`h-8 w-auto select-none ${className}`}
      draggable={false}
    />
  );
}
