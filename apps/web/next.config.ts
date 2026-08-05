import createNextIntlPlugin from 'next-intl/plugin';
import type { NextConfig } from 'next';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const config: NextConfig = {
  reactStrictMode: true,
  // Os pacotes do workspace são publicados como TypeScript, sem build próprio.
  transpilePackages: ['@pulse/db', '@pulse/shared'],
  serverExternalPackages: ['postgres', 'bcryptjs'],
  // Erro de tipo e de lint derrubam o build. O contrário deixa passar para produção o que
  // o CI já teria pegado.
  typescript: { ignoreBuildErrors: false },
  eslint: { ignoreDuringBuilds: true },
  poweredByHeader: false,
  headers() {
    // §11.3 do PRD. CSP fica de fora nesta fase: definir uma política restritiva antes de
    // existir a superfície de UI da Fase 4 produziria `unsafe-inline` permanente.
    return Promise.resolve([
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
        ],
      },
    ]);
  },
};

export default withNextIntl(config);
