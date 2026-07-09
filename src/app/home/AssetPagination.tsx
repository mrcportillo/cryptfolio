import Link from "next/link";
import { Button } from "@/components/ui/button";

type AssetPaginationProps = {
  page: number;
  pageSize: number;
  total: number;
  coin: string;
};

function hrefFor(page: number, coin: string) {
  const params = new URLSearchParams({ page: String(page) });
  if (coin !== "all") {
    params.set("coin", coin);
  }
  return `/home?${params.toString()}`;
}

export default function AssetPagination({
  page,
  pageSize,
  total,
  coin,
}: AssetPaginationProps) {
  const totalPages = Math.ceil(total / pageSize);

  if (totalPages <= 1) {
    return null;
  }

  return (
    <nav
      aria-label="Asset pages"
      className="flex flex-wrap items-center justify-between gap-3 border-t pt-4"
    >
      <p className="text-sm text-muted-foreground">
        Page {page} of {totalPages}
      </p>
      <div className="flex gap-2">
        <Button asChild variant="outline" disabled={page <= 1}>
          <Link
            href={hrefFor(Math.max(1, page - 1), coin)}
            aria-disabled={page <= 1}
            tabIndex={page <= 1 ? -1 : undefined}
            className={page <= 1 ? "pointer-events-none opacity-50" : undefined}
          >
            Previous
          </Link>
        </Button>
        <Button asChild variant="outline" disabled={page >= totalPages}>
          <Link
            href={hrefFor(Math.min(totalPages, page + 1), coin)}
            aria-disabled={page >= totalPages}
            tabIndex={page >= totalPages ? -1 : undefined}
            className={
              page >= totalPages ? "pointer-events-none opacity-50" : undefined
            }
          >
            Next
          </Link>
        </Button>
      </div>
    </nav>
  );
}
