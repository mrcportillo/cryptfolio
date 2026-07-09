import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="mx-2 my-10 flex flex-col items-start gap-4 sm:mx-4 md:mx-8 lg:mx-20">
      <h1 className="text-3xl font-semibold text-primary-950">
        Asset not found
      </h1>
      <p className="text-muted-foreground">
        This asset does not exist or is not part of your portfolio.
      </p>
      <Button asChild>
        <Link href="/home">Back to portfolio</Link>
      </Button>
    </main>
  );
}
