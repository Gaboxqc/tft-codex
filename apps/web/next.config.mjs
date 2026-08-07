/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // packages/ui ships TypeScript sources rather than a bundled artifact, so
  // Next compiles it in-place. Keeps the web app and the Overwolf app on the
  // exact same component code with no publish step between them (R10.2).
  transpilePackages: ['@tft-codex/ui', '@tft-codex/shared-types'],
  env: {
    NEXT_PUBLIC_API_BASE_URL: process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000',
  },
};

export default nextConfig;
