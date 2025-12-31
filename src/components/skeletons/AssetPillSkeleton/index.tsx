import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function AssetPillSkeleton() {
  return (
    <Card className="w-full border-0 bg-gradient-to-br from-primary-200 via-primary-400 to-primary-700 shadow-lg sm:w-[320px] lg:w-[360px]">
      <CardHeader className="pb-4">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-2">
            <Skeleton className="h-7 w-32 bg-primary-500/60" />
            <Skeleton className="h-9 w-24 bg-primary-500/60" />
          </div>
          <Skeleton className="h-9 w-9 rounded-md bg-primary-500/60" />
        </div>
      </CardHeader>
      <CardContent className="space-y-2 pt-0">
        <Skeleton className="h-4 w-28 bg-primary-500/60" />
        <Skeleton className="h-4 w-20 bg-primary-500/60" />
        <Skeleton className="h-4 w-20 bg-primary-500/60" />
        <Skeleton className="h-4 w-24 bg-primary-500/60" />
      </CardContent>
    </Card>
  );
}
