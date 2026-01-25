import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Navigation } from "@/components/layout/Navigation";
import { StorageCleanup } from "@/components/layout/StorageCleanup";
import { Toaster } from "sonner";
import { AuthProvider } from "@/contexts/AuthContext";
import { LedgerSyncManager } from '@/components/LedgerSyncManager';

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "NZ Landlord - Professional Property Management",
  description: "Advanced rent tracking and tax vault for independent landlords.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased min-h-screen bg-[#0B0E11]`}
      >
        <AuthProvider>
          <LedgerSyncManager />  <StorageCleanup />
          <Navigation />
          {/* Command Center Layout - Full width with top nav offset */}
          <main className="min-h-screen pt-16 pb-20 md:pb-8">
            <div className="w-full">
              {children}
            </div>
          </main>
          <Toaster position="top-center" richColors theme="dark" />
        </AuthProvider>
      </body>
    </html>
  );
}
