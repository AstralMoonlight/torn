import type { Metadata, Viewport } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import { ThemeProvider } from 'next-themes'
import './globals.css'
import AppShell from '@/components/layout/AppShell'

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
})

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
})

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
}

export const metadata: Metadata = {
  title: 'Torn POS — Sistema de Ventas',
  description: 'Punto de Venta Profesional — Torn',
}

const COLOR_SCRIPT = `try{var p=location.pathname.split('/')[1];if(['login','select-tenant','saas-admin'].indexOf(p)<0){var c=JSON.parse(localStorage.getItem('torn-color'));if(c){var s=document.documentElement.style;s.setProperty('--primario-claro',c.claro);s.setProperty('--primario-oscuro',c.oscuro)}}}catch(e){}`

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="es" suppressHydrationWarning>
      <head>
        {/* Aplica el último color principal antes de pintar, para que no parpadee el
            azul mientras cargan los ajustes. Ver lib/colores.ts (COLOR_APLICADO_KEY). */}
        <script dangerouslySetInnerHTML={{ __html: COLOR_SCRIPT }} />
      </head>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <ThemeProvider attribute="class" defaultTheme="light" enableSystem disableTransitionOnChange>
          <AppShell>{children}</AppShell>
        </ThemeProvider>
      </body>
    </html>
  )
}
