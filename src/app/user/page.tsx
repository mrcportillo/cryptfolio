import { getSession } from "@auth0/nextjs-auth0";
import Image from "next/image";
import PageContainer from "../../components/pages/PageContainer";
import PageHeaeder from "../../components/pages/PageHeader";
import PageContent from "../../components/pages/PageContent";
import PageTitle from "../../components/pages/PageTitle";

export default async function Profile() {
  const session = await getSession();
  const user = session?.user;

  return (
    user && (
      <PageContainer>
        <PageHeaeder>
          <PageTitle>Profile</PageTitle>
        </PageHeaeder>
        <PageContent>
          <Image src={user.picture} alt={user.name} width={100} height={100} />
          <div className="mt-2">
            <h2>{user.name}</h2>
            <a
              href="/api/auth/logout"
              className="text-red-800 hover:text-red-600"
            >
              Logout
            </a>
          </div>
        </PageContent>
      </PageContainer>
    )
  );
}
