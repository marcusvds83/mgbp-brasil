import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  // Habilita instrumentation.ts (executa register() no startup do servidor)
  // Necessário para o polling automático de emissões/cancelamentos
  experimental: {
    instrumentationHook: true,
  },
};

export default nextConfig;
