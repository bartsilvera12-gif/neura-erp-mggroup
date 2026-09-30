import type { Metadata } from "next";
import localFont from "next/font/local";
import AppShell from "../components/AppShell";
import { ThemeProvider } from "../components/ThemeProvider";
import AuthGuard from "../components/AuthGuard";
import { getSingleClientName } from "../lib/instance/single-client";
import "./globals.css";

/**
 * Fuentes locales, no `next/font/google`: con Google, `next build` descarga las fuentes en medio
 * del build y, si esa descarga se corta (build server cargado, red), aborta el deploy entero
 * ("Failed to fetch `Plus Jakarta Sans` from Google Fonts"). Son los mismos archivos que Google
 * entregaba (subset latino, fuentes variables: un archivo cubre todos los pesos). Licencia OFL.
 */
const plusJakarta = localFont({
  src: "./fonts/plus-jakarta-sans-latin.woff2",
  variable: "--font-plus-jakarta",
  weight: "300 800",
  display: "swap",
});

const geistMono = localFont({
  src: "./fonts/geist-mono-latin.woff2",
  variable: "--font-geist-mono",
  weight: "100 900",
  display: "swap",
});

/**
 * Nombre de la pestaña del navegador. Sale de `NEURA_CLIENT_NAME`; si no está seteada
 * se usa el nombre de este despliegue, para que la pestaña nunca muestre «ERP» pelado.
 */
const NOMBRE_POR_DEFECTO = "MG Group";

export function generateMetadata(): Metadata {
  const nombre = getSingleClientName();
  const titulo = nombre && nombre !== "ERP" ? nombre : NOMBRE_POR_DEFECTO;
  return {
    title: titulo,
    description: `Sistema de gestión empresarial de ${titulo}`,
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" suppressHydrationWarning>
      <body className={`${plusJakarta.variable} ${geistMono.variable} antialiased`}>
        <ThemeProvider>
          <AuthGuard>
            <AppShell>{children}</AppShell>
          </AuthGuard>
        </ThemeProvider>
      </body>
    </html>
  );
}