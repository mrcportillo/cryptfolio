import { Auth0Provider } from "@auth0/nextjs-auth0/client";
import "./globals.css";
import NavBar from "../components/Navbar";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { Analytics } from "@vercel/analytics/next";
import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Cryptfolio app",
};

type RootLayoutProps = {
  children: ReactNode;
};

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html lang="en">
      <Auth0Provider>
        <body className="min-h-screen bg-background font-sans text-foreground">
          <SpeedInsights />
          <Analytics />
          <NavBar />
          <main>{children}</main>
        </body>
      </Auth0Provider>
    </html>
  );
}
