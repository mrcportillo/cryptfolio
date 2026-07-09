"use client"; // Error components must be Client Components

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type ErrorProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function Error({ error, reset }: ErrorProps) {
  useEffect(() => {
    if (error.digest) {
      console.error("Application error", error.digest);
    }
  }, [error.digest]);

  return (
    <div className="mx-2 my-4 flex flex-col sm:mx-4 md:mx-8 md:my-10 lg:mx-20">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle>Something went wrong</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            We were unable to complete that request. Please try again.
          </p>
          <Button className="mt-6" onClick={() => reset()}>
            Try again
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
