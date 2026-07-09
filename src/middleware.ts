import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";

export async function middleware(request: NextRequest) {
  const response = await auth0.middleware(request);
  const pathname = request.nextUrl.pathname;

  if (pathname.startsWith("/api/auth")) {
    return response;
  }

  const session = await auth0.getSession(request);
  if (session?.user) {
    return response;
  }

  if (pathname.startsWith("/api")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const returnTo = `${pathname}${request.nextUrl.search}`;
  return NextResponse.redirect(
    new URL(
      `/api/auth/login?returnTo=${encodeURIComponent(returnTo)}`,
      request.url,
    ),
  );
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)",
  ],
};
