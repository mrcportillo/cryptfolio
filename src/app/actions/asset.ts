"use server";
import { getSession } from "@auth0/nextjs-auth0";
import prisma from "../../services/prisma/client";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

function requireString(formData: FormData, key: string): string {
  const value = formData.get(key);
  if (typeof value !== "string") {
    throw new Error(`Missing form value: ${key}`);
  }
  return value;
}

export async function create(formData: FormData) {
  const session = await getSession();
  const user = session?.user;
  if (!user?.sub) {
    throw new Error("Unauthorized");
  }
  const newAsset = {
    userId: user.sub,
    assetId: requireString(formData, "coin"),
    assetName: requireString(formData, "name"),
    amount: Number(requireString(formData, "amount")),
  };

  try {
    await prisma.userAsset.create({
      data: newAsset,
    });
  } catch (error) {
    console.error(error);
    throw new Error("Error creating asset");
  }
  redirect("/home");
}

export async function update(formData: FormData) {
  const userAssetId = requireString(formData, "id");
  let asset;
  try {
    asset = await prisma.userAsset.findUnique({
      where: {
        id: userAssetId,
      },
    });
  } catch (error) {
    console.error(error);
    throw new Error("Error getting asset");
  }

  if (!asset) {
    throw new Error("Asset not found");
  }

  try {
    await prisma.assetArchive.create({
      data: {
        userAssetId,
        amount: asset.amount,
        date: asset.date,
      },
    });
  } catch (error) {
    console.error(error);
    throw new Error("Error creating asset archive");
  }

  const updatedAsset = {
    assetName: requireString(formData, "name"),
    amount: Number(requireString(formData, "amount")),
    date: new Date(),
  };

  try {
    await prisma.userAsset.update({
      where: {
        id: userAssetId,
      },
      data: updatedAsset,
    });
  } catch (error) {
    console.error(error);
    throw new Error("Error updating asset");
  }
  revalidatePath("/home");
}

export async function remove(assetId: string) {
  try {
    await prisma.userAsset.delete({
      where: {
        id: assetId,
      },
    });
  } catch (error) {
    console.error(error);
    throw new Error("Error deleting asset");
  }
  redirect("/home");
}
