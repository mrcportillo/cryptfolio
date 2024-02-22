"use server";
import { getSession } from "@auth0/nextjs-auth0";
import prisma from "../../services/prisma/client.js";
import { redirect } from "next/navigation.js";

export async function create(formData) {
  const { user } = await getSession();
  const newAsset = {
    userId: user.sub,
    assetId: formData.get("coin"),
    assetName: formData.get("name"),
    amount: Number(formData.get("amount")),
  };

  try {
    await prisma.userAsset.create({
      data: newAsset,
    });
  } catch (error) {
    throw new Error("Error creating asset");
  }
  redirect("/");
}
