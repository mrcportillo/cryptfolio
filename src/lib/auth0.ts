import { Auth0Client } from "@auth0/nextjs-auth0/server";
import { NextResponse } from "next/server";
import { AUTH0_PROFILE_ROUTE } from "@/lib/auth-routes";
import { logServerError } from "@/lib/logger";
import prisma from "@/services/prisma/client";
import { persistSessionUser } from "@/services/prisma/session-user";

function getAuth0Domain() {
  if (process.env.AUTH0_DOMAIN) {
    return process.env.AUTH0_DOMAIN;
  }

  const issuer = process.env.AUTH0_ISSUER_BASE_URL;
  return issuer ? new URL(issuer).hostname : undefined;
}

const baseUrl = process.env.APP_BASE_URL ?? process.env.AUTH0_BASE_URL;

export const auth0 = new Auth0Client({
  domain: getAuth0Domain(),
  appBaseUrl: baseUrl,
  routes: {
    login: "/api/auth/login",
    logout: "/api/auth/logout",
    callback: "/api/auth/callback",
    profile: AUTH0_PROFILE_ROUTE,
  },
  onCallback: async (error, context, session) => {
    const redirectBase =
      context.appBaseUrl ?? baseUrl ?? "http://localhost:3000";

    if (error || !session?.user) {
      if (error) {
        logServerError("auth.callback", error);
      }

      return NextResponse.redirect(new URL("/home?authError=1", redirectBase));
    }

    try {
      await persistSessionUser(prisma, {
        id: session.user.sub,
        name: session.user.name ?? session.user.nickname ?? "Cryptfolio user",
        email: session.user.email ?? `${session.user.sub}@unknown.local`,
      });
    } catch (upsertError) {
      logServerError("auth.callback.upsert-user", upsertError);
      return NextResponse.redirect(new URL("/home?authError=1", redirectBase));
    }

    const returnTo = context.returnTo?.startsWith("/")
      ? context.returnTo
      : "/home";
    return NextResponse.redirect(new URL(returnTo, redirectBase));
  },
});
