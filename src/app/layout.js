import { UserProvider } from "@auth0/nextjs-auth0/client";
import { Inter } from "next/font/google";
import "./globals.css";
import NavBar from "../components/Navbar";

const inter = Inter({ subsets: ["latin"] });

export const metadata = {
  title: "Cryptfolio app",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <UserProvider>
        <body className={inter.className}>
          <NavBar />
          {children}
        </body>
      </UserProvider>
    </html>
  );
}
