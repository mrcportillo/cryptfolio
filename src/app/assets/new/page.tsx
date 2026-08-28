import NewAssetForm from "@/components/forms/NewAssetForm";
import list from "@/services/coin/list";
import type { CoinListItem } from "@/services/coin/types";
import type { CoinOption } from "@/types/coin";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireCurrentUser } from "@/lib/auth";
import { listOwnedTransactionPositions } from "@/services/portfolio-transactions/queries";
import prisma from "@/services/prisma/client";
import { redirect } from "next/navigation";

async function getCoinOptions(): Promise<CoinOption[]> {
  const coinList: CoinListItem[] = await list(100);
  return coinList.map((coin) => ({
    value: coin.id,
    label: coin.name,
  }));
}

export default async function NewAsset() {
  const user = await requireCurrentUser();
  const catalog = await listOwnedTransactionPositions(prisma, user.id);
  if (catalog.ledgerAdopted) {
    redirect("/transactions/new?kind=TRANSFER_IN&position=new");
  }

  let coinOptions: CoinOption[] = [];
  let loadError: string | undefined;

  try {
    coinOptions = await getCoinOptions();
  } catch {
    loadError = "Coin data is temporarily unavailable. Please try again later.";
  }

  return (
    <div className="mx-2 my-4 flex flex-col sm:mx-4 md:mx-8 md:my-10 lg:mx-20">
      <Card className="w-full md:w-1/2">
        <CardHeader>
          <CardTitle>New Asset</CardTitle>
        </CardHeader>
        <CardContent>
          <NewAssetForm coinOptions={coinOptions} loadError={loadError} />
        </CardContent>
      </Card>
    </div>
  );
}
