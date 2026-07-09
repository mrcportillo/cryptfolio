import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function LoadingTrend() {
  return (
    <main className="mx-2 my-4 flex flex-col gap-4 sm:mx-4 md:mx-8 md:my-10 lg:mx-20">
      <Skeleton className="h-10 w-32" />
      <div className="grid gap-6 lg:grid-cols-2">
        {Array.from({ length: 4 }, (_, index) => (
          <Card key={index}>
            <CardHeader>
              <Skeleton className="h-6 w-40" />
              <Skeleton className="h-4 w-24" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-60 w-full" />
            </CardContent>
          </Card>
        ))}
      </div>
    </main>
  );
}
