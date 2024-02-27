"use client";
import { useUser } from "@auth0/nextjs-auth0/client";
import Image from "next/image";

const NavContainer = ({ children }) => (
  <nav className="bg-primary-100 shadow-md">
    <div className="flex py-2 pr-2 md:px-4">{children}</div>
  </nav>
);

const NavItem = ({ path, children, danger = false, active }) => (
  <a
    href={path}
    className={`px-3 py-4 text-sm font-medium  ${danger ? "text-rose-700 hover:text-rose-500" : active ? "text-slate-500" : "text-slate-900 hover:text-slate-500"} `}
  >
    {children}
  </a>
);

const RightContainer = ({ children }) => (
  <div className="ml-auto flex">{children}</div>
);

const UserAvatar = ({ src, alt }) => (
  <a href="/user" className="self-center">
    <Image
      src={src}
      alt={alt}
      width={40}
      height={40}
      className="h-10 rounded-full hover:cursor-pointer"
    />
  </a>
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
  const currentPath = window.location.pathname;

  return (
    <NavContainer>
      <AppImage />
      <NavItem path="/" active={currentPath === "/"}>
        Home
      </NavItem>
      <NavItem path="/other" active={currentPath === "/other"}>
        other
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
