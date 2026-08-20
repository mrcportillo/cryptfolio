type OwnedAssetWhere = {
  id: string;
  userId: string;
};

type OwnedAssetVersionWhere = OwnedAssetWhere & {
  date: Date;
};

type AssetUpdateData = {
  assetName: string;
  amount: number;
  date: Date;
};

type ArchiveCreateData = {
  userAssetId: string;
  amount: number;
  date: Date;
};

export type AssetMutationTransaction = {
  userAsset: {
    update(args: {
      where: OwnedAssetVersionWhere;
      data: AssetUpdateData;
    }): Promise<unknown>;
  };
  assetArchive: {
    create(args: { data: ArchiveCreateData }): Promise<unknown>;
  };
};

export type AssetMutationClient = {
  $transaction<T>(
    operation: (transaction: AssetMutationTransaction) => Promise<T>,
  ): Promise<T>;
  userAsset: {
    delete(args: { where: OwnedAssetWhere }): Promise<unknown>;
  };
};

type UpdateOwnedAssetInput = {
  id: string;
  userId: string;
  previousAmount: number;
  previousDate: Date;
  assetName: string;
  amount: number;
};

export async function updateOwnedAsset(
  client: AssetMutationClient,
  input: UpdateOwnedAssetInput,
) {
  const updatedAt = new Date(
    Math.max(Date.now(), input.previousDate.getTime() + 1),
  );

  await client.$transaction(async (transaction) => {
    await transaction.userAsset.update({
      where: {
        id: input.id,
        userId: input.userId,
        date: input.previousDate,
      },
      data: {
        assetName: input.assetName,
        amount: input.amount,
        date: updatedAt,
      },
    });

    await transaction.assetArchive.create({
      data: {
        userAssetId: input.id,
        amount: input.previousAmount,
        date: input.previousDate,
      },
    });
  });
}

export async function deleteOwnedAsset(
  client: AssetMutationClient,
  id: string,
  userId: string,
) {
  await client.userAsset.delete({
    where: {
      id,
      userId,
    },
  });
}
