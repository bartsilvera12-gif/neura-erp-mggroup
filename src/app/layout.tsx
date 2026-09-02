import type { Metadata } from "next";
import { Plus_Jakarta_Sans, Geist_Mono } from "next/font/google";
import AppShell from "../components/AppShell";
import { ThemeProvider } from "../components/ThemeProvider";
import AuthGuard from "../components/AuthGuard";
import { getSingleClientName } from "../lib/instance/single-client";
import "./globals.css";

const plusJakarta = Plus_Jakarta_Sans({
  variable: "--font-plus-jakarta",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700", "800"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
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