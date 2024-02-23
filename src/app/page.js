import Link from "next/link";
import PageContainer from "../components/pages/PageContainer";
import PageHeaeder from "../components/pages/PageHeader";
import PageContent from "../components/pages/PageContent";
import UserAssetsList from "../components/UserAssetsList";
import Button from "../components/Button";
import PageTitle from "../components/pages/PageTitle";

export default function Home() {
  return (
    <PageContainer>
      <PageHeaeder>
        <PageTitle>User assets</PageTitle>
        <div className="ml-auto sm:ml-8">
          <Link href="/assets/new">
            <Button>New asset</Button>
          </Link>
        </div>
      </PageHeaeder>
      <PageContent>
        <UserAssetsList />
      </PageContent>
    </PageContainer>
  );
}
