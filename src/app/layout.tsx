import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Navigation } from "@/components/layout/Navigation";
import { StorageCleanup } from "@/components/layout/StorageCleanup";
import { Toaster } from "sonner";
import { AuthProvider } from "@/contexts/AuthContext";

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
        className={`${geistSans.variable} ${geistMono.variable} antialiased min-h-screen bg-[#f7f9fa]`}
      >
        <AuthProvider>
          <StorageCleanup />
          <Navigation />
          <main className="md:pl-64 min-h-screen pb-24 md:pb-0">
            <div className="p-4 md:p-10 max-w-7xl mx-auto">
              {children}
            </div>
          </main>
          <Toaster position="top-center" richColors />
        </AuthProvider>
      </body>
    </html>
  );
}
