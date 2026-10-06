import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Esconde o indicador "Rendering..." no canto inferior em modo dev
  devIndicators: false,
  // Build standalone — gera Dockerfile menor (só com runtime necessário)
  output: "standalone",
  // Limite do corpo das requisições (fotos e arquivos do painel, até ~15MB)
  // (default do Next 16 é 10MB e corta o body, quebrando o parse do FormData)
  experimental: {
    proxyClientMaxBodySize: "20mb",
    serverActions: {
      // Fotos e arquivos enviados pelo painel de atendimento (limite do WhatsApp ~15MB)
      bodySizeLimit: "16mb",
    },
  },
};

export default nextConfig;
