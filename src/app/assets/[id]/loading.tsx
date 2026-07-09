import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function LoadingAsset() {
  return (
    <main className="mx-2 my-4 sm:mx-4 md:mx-8 md:my-10 lg:mx-20">
      <Skeleton className="mb-4 h-10 w-64" />
      <div className="flex flex-col gap-4 sm:flex-row">
        <Card className="w-full md:w-1/2">
          <CardHeader>
            <Skeleton className="h-6 w-32" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-36 w-full" />
          </CardContent>
        </Card>
        <Card className="w-full sm:w-1/4">
          <CardHeader>
            <Skeleton className="h-6 w-32" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-28 w-full" />
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
