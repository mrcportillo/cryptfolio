import Link from "next/link";
import AssetsListSkeleton from "@/components/skeletons/AssetsListSkeleton";
import { Button } from "@/components/ui/button";

export default function LoadingHome() {
  return (
    <div className="mx-2 my-4 flex flex-col sm:mx-4 md:mx-8 md:my-10 lg:mx-20">
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
