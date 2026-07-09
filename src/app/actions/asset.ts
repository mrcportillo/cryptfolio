"use server";
import { requireCurrentUser } from "@/lib/auth";
import { logServerError } from "@/lib/logger";
import { validateAssetFormData } from "@/lib/validation";
import type { AssetActionState } from "@/types/action";
import prisma from "@/services/prisma/client";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

export async function create(
  _previousState: AssetActionState,
  formData: FormData,
): Promise<AssetActionState> {
  const user = await requireCurrentUser();
  const validation = validateAssetFormData(formData);

  if (!validation.values) {
    return { fieldErrors: validation.fieldErrors };
  }

  try {
    await prisma.userAsset.create({
      data: {
        userId: user.id,
        assetId: validation.values.assetId,
        assetName: validation.values.assetName,
        amount: validation.values.amount,
      },
    });
  } catch (error) {
    logServerError("asset.create", error, { userId: user.id });
    return { error: "We could not create the asset. Please try again." };
  }

  redirect("/home");
}

export async function update(
  _previousState: AssetActionState,
  formData: FormData,
): Promise<AssetActionState> {
  const user = await requireCurrentUser();
  const validation = validateAssetFormData(formData, {
    requireId: true,
    requireCoin: false,
  });

  if (!validation.values?.id) {
    return { fieldErrors: validation.fieldErrors };
  }

  const userAssetId = validation.values.id;
  let asset;
  try {
    asset = await prisma.userAsset.findFirst({
      where: {
        id: userAssetId,
        userId: user.id,
      },
    });
  } catch (error) {
    logServerError("asset.update.lookup", error, { userId: user.id });
    return { error: "We could not load the asset. Please try again." };
  }

  if (!asset) {
    return { error: "Asset not found." };
  }

  try {
    await prisma.$transaction([
      prisma.assetArchive.create({
        data: {
          userAssetId,
          amount: asset.amount,
          date: asset.date,
        },
      }),
      prisma.userAsset.update({
        where: { id: userAssetId },
        data: {
          assetName: validation.values.assetName,
          amount: validation.values.amount,
          date: new Date(),
        },
      }),
    ]);
  } catch (error) {
    logServerError("asset.update", error, { userId: user.id });
    return { error: "We could not update the asset. Please try again." };
  }

  revalidatePath("/home");
  revalidatePath(`/assets/${userAssetId}`);
  return {};
}

export async function remove(assetId: string) {
  const user = await requireCurrentUser();

  try {
    const asset = await prisma.userAsset.findFirst({
      where: { id: assetId, userId: user.id },
      select: { id: true },
    });

    if (!asset) {
      throw new Error("Asset not found");
    }

    await prisma.userAsset.delete({
      where: {
        id: assetId,
      },
    });
  } catch (error) {
    logServerError("asset.remove", error, { userId: user.id });
    throw new Error("We could not remove the asset.");
  }

  revalidatePath("/home");
  redirect("/home");
}
