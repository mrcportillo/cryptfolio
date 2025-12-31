"use client";
import { useUser } from "@auth0/nextjs-auth0/client";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { PropsWithChildren } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const NavContainer = ({ children }: PropsWithChildren) => (
  <nav className="bg-primary-100 shadow-md">
    <div className="flex py-2 pr-2 md:px-4">{children}</div>
  </nav>
);

type NavItemProps = PropsWithChildren<{
  path: string;
  danger?: boolean;
  active?: boolean;
}>;

const NavItem = ({ path, children, danger = false, active }: NavItemProps) => (
  <Button
    asChild
    variant="ghost"
    className={cn(
      "h-auto px-3 py-4 text-sm font-medium",
      danger && "text-destructive hover:text-destructive",
      active ? "text-muted-foreground" : "text-slate-900 hover:text-slate-500",
    )}
  >
    <Link href={path}>{children}</Link>
  </Button>
);

const RightContainer = ({ children }: PropsWithChildren) => (
  <div className="ml-auto flex">{children}</div>
);

type UserAvatarProps = {
  src: string;
  alt: string;
};

const UserAvatar = ({ src, alt }: UserAvatarProps) => (
  <Link href="/user" className="self-center">
    <Avatar>
      <AvatarImage src={src} alt={alt} />
      <AvatarFallback>{alt?.slice(0, 1) ?? "U"}</AvatarFallback>
    </Avatar>
  </Link>
);

const AppImage = () => (
  <Image
    src="/images/logo.png"
    alt="App Logo"
    width={60}
    height={60}
    className="h-14"
  />
);

export default function NavBar() {
  const { user } = useUser();
  const currentPath = usePathname();

  return (
    <NavContainer>
      <AppImage />
      <NavItem path="/home" active={currentPath === "/home"}>
        Home
      </NavItem>
      <NavItem path="/trend" active={currentPath === "/trend"}>
        Trend
      </NavItem>
      <RightContainer>
        {!user ? (
          <NavItem path="/api/auth/login">Login</NavItem>
        ) : (
          <UserAvatar src={user.picture} alt={user.name} />
        )}
      </RightContainer>
    </NavContainer>
  );
}
