/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@app/shared'],
  experimental: { externalDir: true },
  webpack: (config) => { config.resolve.extensionAlias = { '.js': ['.ts', '.tsx', '.js'] }; return config; },
  async rewrites() {
    const api = process.env.API_INTERNAL_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
    return [{ source: '/api/:path*', destination: `${api}/api/:path*` }];
  },
};
export default nextConfig;
