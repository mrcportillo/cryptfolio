import { auth0 } from "@/lib/auth0";

export type CurrentUser = {
  id: string;
  name?: string;
  email?: string;
  picture?: string;
};

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const session = await auth0.getSession();
  const subject = session?.user?.sub;

  if (!subject) {
    return null;
  }

  return {
    id: subject,
    name: session.user.name,
    email: session.user.email,
    picture: session.user.picture,
  };
}

export async function requireCurrentUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();

  if (!user) {
    throw new Error("Unauthorized");
  }

  return user;
}
