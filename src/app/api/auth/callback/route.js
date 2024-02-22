import prisma from "@/services/prisma/client";
import { handleCallback } from "@auth0/nextjs-auth0";

const upsertUser = async (req, session) => {
  const { user } = session;

  if (!user) {
    return {
      status: 401,
      body: { message: "Unauthorized" },
    };
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
    return {
      status: 500,
      body: { message: "Internal Server Error" },
    };
  }
};

export async function GET(req, res) {
  return await handleCallback(req, res, {
    afterCallback: upsertUser,
  });
}
