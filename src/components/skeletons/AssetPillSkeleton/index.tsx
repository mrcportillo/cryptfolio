import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function AssetPillSkeleton() {
  return (
    <Card className="w-72 border-0 bg-gradient-to-br from-primary-300 to-primary-700 shadow">
      <CardHeader className="pb-3">
        <Skeleton className="h-6 w-28 bg-primary-500/60" />
      </CardHeader>
      <CardContent className="space-y-2 pt-0">
        <Skeleton className="h-4 w-28 bg-primary-500/60" />
        <Skeleton className="h-4 w-16 bg-primary-500/60" />
        <Skeleton className="h-4 w-20 bg-primary-500/60" />
        <Skeleton className="h-4 w-10 bg-primary-500/60" />
        <Skeleton className="h-4 w-24 bg-primary-500/60" />
      </CardContent>
    </Card>
  );
}
