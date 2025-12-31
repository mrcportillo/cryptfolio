import { UserProvider } from "@auth0/nextjs-auth0/client";
import { Inter } from "next/font/google";
import "./globals.css";
import NavBar from "../components/Navbar";
import { SpeedInsights } from "@vercel/speed-insights/next";
import type { Metadata } from "next";
import type { ReactNode } from "react";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Cryptfolio app",
};

type RootLayoutProps = {
  children: ReactNode;
};

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html lang="en">
      <UserProvider>
        <body className={inter.className}>
          <SpeedInsights />
          <NavBar />
          {children}
        </body>
      </UserProvider>
    </html>
  );
}
