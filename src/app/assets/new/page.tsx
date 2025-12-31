import { create } from "@/app/actions/asset";
import Buttons from "@/components/forms/Buttons";
import list from "@/services/coin/list";
import type { CoinListItem } from "@/services/coin/types";
import type { CoinOption } from "@/types/coin";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

async function getCoinOptions(): Promise<CoinOption[]> {
  const coinList: CoinListItem[] = await list(50);
  return coinList.map((coin: CoinListItem) => ({
    value: coin.id,
    label: coin.name,
  }));
}

export default async function NewAsset() {
  const coinOptions = await getCoinOptions();

  return (
    <div className="mx-2 my-4 flex flex-col sm:mx-4 md:mx-8 md:my-10 lg:mx-20">
      <Card className="w-full md:w-1/2">
        <CardHeader>
          <CardTitle>New Asset</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-4" action={create}>
            <div className="grid gap-2">
              <Label htmlFor="name">Alias</Label>
              <Input id="name" name="name" type="text" required />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="coin">Coin</Label>
              <Select name="coin" required>
                <SelectTrigger id="coin">
                  <SelectValue placeholder="Select a coin" />
                </SelectTrigger>
                <SelectContent>
                  {coinOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="amount">Amount</Label>
              <Input id="amount" name="amount" type="d" step="any" required />
            </div>
            <Buttons cancelLabel={"Cancel"} confirmLabel={"Save"} />
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
