import Link from "next/link";
import AssetsListSkeleton from "@/components/skeletons/AssetsListSkeleton";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function LoadingHome() {
  return (
    <div className="mx-2 my-4 flex flex-col sm:mx-4 md:mx-8 md:my-10 lg:mx-20">
      <div className="mb-6">
        <Card className="w-full border-0 bg-gradient-to-br from-primary-200 via-primary-400 to-primary-700 shadow-lg">
          <CardHeader className="pb-2">
            <Skeleton className="h-4 w-40 bg-primary-500/60" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-12 w-52 bg-primary-500/60 sm:h-14 md:h-16" />
          </CardContent>
        </Card>
      </div>
      <div className="mb-2 flex items-center">
        <h1 className="text-3xl font-semibold text-primary-950">Assets</h1>
        <div className="ml-auto sm:ml-8">
          <Button asChild>
            <Link href="/assets/new">New asset</Link>
          </Button>
        </div>
      </div>
      <div className="my-4">
        <AssetsListSkeleton />
      </div>
    </div>
  );
}
