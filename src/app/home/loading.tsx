import Link from "next/link";
import PageContainer from "../../components/pages/PageContainer";
import PageHeaeder from "../../components/pages/PageHeader";
import PageContent from "../../components/pages/PageContent";
import Button from "../../components/Button";
import PageTitle from "../../components/pages/PageTitle";
import AssetsListSkeleton from "@/components/skeletons/AssetsListSkeleton";

export default function LoadingHome() {
  return (
    <PageContainer>
      <PageHeaeder>
        <PageTitle>Assets</PageTitle>
        <div className="ml-auto sm:ml-8">
          <Link href="/assets/new">
            <Button>New asset</Button>
          </Link>
        </div>
      </PageHeaeder>
      <PageContent>
        <AssetsListSkeleton />
      </PageContent>
    </PageContainer>
  );
}
