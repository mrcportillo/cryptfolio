import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function LoadingProfile() {
  return (
    <main className="mx-2 my-4 sm:mx-4 md:mx-8 md:my-10 lg:mx-20">
      <Card className="w-full max-w-md">
        <CardHeader>
          <Skeleton className="h-7 w-28" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-24 w-full" />
        </CardContent>
      </Card>
    </main>
  );
}
