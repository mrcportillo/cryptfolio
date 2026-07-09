import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function LoadingNewAsset() {
  return (
    <main className="mx-2 my-4 sm:mx-4 md:mx-8 md:my-10 lg:mx-20">
      <Card className="w-full md:w-1/2">
        <CardHeader>
          <Skeleton className="h-7 w-36" />
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </CardContent>
      </Card>
    </main>
  );
}
