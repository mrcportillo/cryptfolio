import { getSession } from "@auth0/nextjs-auth0";
import Image from "next/image";

const NavContainer = ({ children }) => (
  <nav className="bg-slate-200 shadow-md">
    <div className="mx-auto flex max-w-7xl p-2 align-middle ">{children}</div>
  </nav>
);

const NavItem = ({ path, children, danger = false }) => (
  <a
    href={path}
    className={`px-3 py-4 text-sm font-medium   ${danger ? "text-rose-700 hover:text-rose-500" : "text-slate-800 hover:text-slate-500"}`}
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

export default async function NavBar() {
  const { user } = await getSession();

  return (
    <NavContainer>
      <AppImage />
      <NavItem path="/">Home</NavItem>
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
