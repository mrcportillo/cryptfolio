import prisma from "@/services/prisma/client";
import { handleCallback } from "@auth0/nextjs-auth0";
import type {
  AfterCallbackAppRoute,
  AppRouteHandlerFnContext,
} from "@auth0/nextjs-auth0";
import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

const upsertUser: AfterCallbackAppRoute = async (_req, session) => {
  const { user } = session;

  if (!user) {
    return Response.json({ message: "Unauthorized" }, { status: 401 });
  }

  try {
    const userRecord = await prisma.user.upsert({
      where: { id: user.sub },
      update: { name: user.nickname, email: user.email },
      create: { id: user.sub, name: user.nickname, email: user.email },
    });
    console.log("User created: ", userRecord);
    return session;
  } catch (error) {
    console.log("Error creating user", error);
    return Response.json(
      { message: "Internal Server Error" },
      { status: 500 },
    );
  }
};

export async function GET(req: NextRequest, ctx: AppRouteHandlerFnContext) {
  return handleCallback(req, ctx, {
    afterCallback: upsertUser,
  });
}
