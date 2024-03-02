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
    console.error(error);
    throw new Error("Error creating asset");
  }
  redirect("/home");
}

export async function update(formData) {
  const userAssetId = formData.get("id");
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
    assetName: formData.get("name"),
    amount: Number(formData.get("amount")),
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
  redirect("/home");
}

export async function remove(assetId) {
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
