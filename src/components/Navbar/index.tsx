"use client";
import { useUser } from "@auth0/nextjs-auth0/client";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { PropsWithChildren } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { AUTH0_PROFILE_ROUTE } from "@/lib/auth-routes";
import { cn } from "@/lib/utils";

const NavContainer = ({ children }: PropsWithChildren) => (
  <nav aria-label="Primary navigation" className="bg-primary-100 shadow-md">
    <div className="flex flex-wrap items-center py-2 pr-2 md:px-4">
      {children}
    </div>
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
    <Link href={path} aria-current={active ? "page" : undefined}>
      {children}
    </Link>
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
  <Link href="/home" aria-label="Go to home">
    <Image
      src="/images/logo.png"
      alt="Cryptfolio logo"
      width={60}
      height={60}
      className="h-14 w-auto"
    />
  </Link>
);

export default function NavBar() {
  const { user, isLoading } = useUser({ route: AUTH0_PROFILE_ROUTE });
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
        {user?.picture ? (
          <UserAvatar src={user.picture} alt={user.name ?? "User profile"} />
        ) : user ? (
          <Link
            href="/user"
            className="self-center rounded-full bg-primary-700 px-3 py-2 text-sm font-medium text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {user.name?.slice(0, 1) ?? "U"}
            <span className="sr-only">Open profile</span>
          </Link>
        ) : isLoading ? null : (
          <NavItem path="/api/auth/login">Login</NavItem>
        )}
      </RightContainer>
    </NavContainer>
  );
}
