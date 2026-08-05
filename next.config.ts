import type { NextConfig } from 'next';

const config: NextConfig = {
  // better-sqlite3 é nativo: precisa ficar fora do bundle do servidor.
  serverExternalPackages: ['better-sqlite3'],
  experimental: {
    // Uploads de resposta são texto curto; o default de 1 MB é folgado.
    serverActions: { bodySizeLimit: '1mb' },
  },
};

export default config;
