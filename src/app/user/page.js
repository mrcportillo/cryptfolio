import { getSession } from "@auth0/nextjs-auth0";
import Image from "next/image";
import PageContainer from "../components/PageContainer";

export default async function Profile() {
  const { user } = await getSession();

  return (
    user && (
      <PageContainer>
        <Image src={user.picture} alt={user.name} width={100} height={100} />
        <div className="mt-2">
          <h2>{user.name}</h2>
          <a href="/api/auth/logout" className="text-red-800 hover:text-red-600">
            Logout
          </a>
        </div>
      </PageContainer>
    )
  );
}
