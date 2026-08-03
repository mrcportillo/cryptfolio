import { getCurrentUser } from "@/lib/auth";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default async function Profile() {
  const user = await getCurrentUser();

  return (
    user && (
      <div className="mx-2 my-4 flex flex-col sm:mx-4 md:mx-8 md:my-10 lg:mx-20">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Profile</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-4">
              {user.picture ? (
                <Image
                  src={user.picture}
                  alt={user.name ?? "User profile"}
                  width={100}
                  height={100}
                  className="h-20 w-20 rounded-full"
                />
              ) : (
                <div className="flex h-20 w-20 items-center justify-center rounded-full bg-primary-100 text-2xl font-semibold text-primary-950">
                  {user.name?.slice(0, 1) ?? "U"}
                </div>
              )}
              <div>
                <h2 className="text-lg font-semibold">{user.name}</h2>
                <Button asChild variant="destructive" className="mt-2">
                  <a href="/api/auth/logout">Logout</a>
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  );
}
