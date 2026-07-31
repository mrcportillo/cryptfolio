import { Auth0Provider } from "@auth0/nextjs-auth0/client";
import "./globals.css";
import NavBar from "../components/Navbar";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { Analytics } from "@vercel/analytics/next";
import { AUTH0_PROFILE_ROUTE, auth0 } from "@/lib/auth0";
import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Cryptfolio app",
};

type RootLayoutProps = {
  children: ReactNode;
};

export default async function RootLayout({ children }: RootLayoutProps) {
  const session = await auth0.getSession();

  return (
    <html lang="en">
      <Auth0Provider user={session?.user} profileRoute={AUTH0_PROFILE_ROUTE}>
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
