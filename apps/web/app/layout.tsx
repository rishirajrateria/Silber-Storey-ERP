import type { Metadata, Viewport } from 'next';
import './globals.css';
import { Providers } from '@/components/providers';

export const metadata: Metadata = { title: 'Lead Manager', description: 'Lead management & consultation', manifest: '/manifest.json' };
export const viewport: Viewport = { themeColor: '#1F3A5F', width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><head><link rel="preconnect" href="https://fonts.googleapis.com" /><link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" /></head>
    <body><Providers>{children}</Providers></body></html>;
}
