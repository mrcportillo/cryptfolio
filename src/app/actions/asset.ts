"use server";
import { requireCurrentUser } from "@/lib/auth";
import { logServerError } from "@/lib/logger";
import { MAX_ASSET_NAME_LENGTH, validateAssetFormData } from "@/lib/validation";
import type { AssetActionState } from "@/types/action";
import prisma from "@/services/prisma/client";
import {
  AssetCutoverError,
  createOwnedAsset,
  deleteOwnedAsset,
  renameOwnedAsset,
  updateOwnedAsset,
} from "@/services/asset/mutations";
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
    await createOwnedAsset(prisma, {
      userId: user.id,
      assetId: validation.values.assetId,
      assetName: validation.values.assetName,
      amount: validation.values.amount,
    });
  } catch (error) {
    if (error instanceof AssetCutoverError) {
      return { error: error.message };
    }
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
    requireVersion: true,
  });

  if (!validation.values?.id || !validation.values.expectedDate) {
    return { fieldErrors: validation.fieldErrors };
  }

  const userAssetId = validation.values.id;
  try {
    await updateOwnedAsset(prisma, {
      id: userAssetId,
      userId: user.id,
      expectedDate: validation.values.expectedDate,
      assetName: validation.values.assetName,
      amount: validation.values.amount,
    });
  } catch (error) {
    if (error instanceof AssetCutoverError) {
      return { error: error.message };
    }
    logServerError("asset.update", error, { userId: user.id });
    return { error: "We could not update the asset. Please try again." };
  }

  revalidatePath("/home");
  revalidatePath(`/assets/${userAssetId}`);
  return {};
}

export async function rename(
  _previousState: AssetActionState,
  formData: FormData,
): Promise<AssetActionState> {
  const user = await requireCurrentUser();
  const id = formData.get("id")?.toString().trim() ?? "";
  const assetName = formData.get("name")?.toString().trim() ?? "";

  if (!id || id.length > 64) {
    return { fieldErrors: { id: "The asset identifier is invalid." } };
  }
  if (!assetName || assetName.length > MAX_ASSET_NAME_LENGTH) {
    return {
      fieldErrors: {
        name: assetName
          ? `Use ${MAX_ASSET_NAME_LENGTH} characters or fewer.`
          : "Enter an alias.",
      },
    };
  }

  try {
    await renameOwnedAsset(prisma, { id, userId: user.id, assetName });
  } catch (error) {
    logServerError("asset.rename", error, { userId: user.id });
    return { error: "We could not rename the asset. Please try again." };
  }

  revalidatePath("/home");
  revalidatePath(`/assets/${id}`);
  return {};
}

export async function remove(assetId: string) {
  const user = await requireCurrentUser();

  try {
    await deleteOwnedAsset(prisma, assetId, user.id);
  } catch (error) {
    logServerError("asset.remove", error, { userId: user.id });
    throw new Error("We could not remove the asset.");
  }

  revalidatePath("/home");
  redirect("/home");
}
