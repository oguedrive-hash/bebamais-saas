/**
 * Categorias fixas do catálogo (mesmo conjunto usado no backfill LLM e na
 * consulta do Caio — consulta-catalogo.ts). Fonte única pra UI.
 */
export const CATEGORIAS_PRODUTO: { value: string; label: string }[] = [
  { value: "cerveja", label: "Cerveja" },
  { value: "refrigerante", label: "Refrigerante" },
  { value: "agua", label: "Água" },
  { value: "agua_de_coco", label: "Água de coco" },
  { value: "suco", label: "Suco" },
  { value: "energetico", label: "Energético" },
  { value: "isotonico", label: "Isotônico" },
  { value: "cha", label: "Chá" },
  { value: "whisky", label: "Whisky" },
  { value: "vodka", label: "Vodka" },
  { value: "gin", label: "Gin" },
  { value: "cachaca", label: "Cachaça" },
  { value: "rum", label: "Rum" },
  { value: "tequila", label: "Tequila" },
  { value: "licor", label: "Licor" },
  { value: "conhaque", label: "Conhaque" },
  { value: "aperitivo", label: "Aperitivo" },
  { value: "vinho", label: "Vinho" },
  { value: "espumante", label: "Espumante" },
  { value: "ice_e_prontos", label: "Ice e prontos" },
  { value: "gelo", label: "Gelo" },
  { value: "carvao", label: "Carvão" },
  { value: "outros", label: "Outros" },
];

export function labelCategoria(value: string | null): string | null {
  if (!value) return null;
  return CATEGORIAS_PRODUTO.find((c) => c.value === value)?.label ?? value;
}
