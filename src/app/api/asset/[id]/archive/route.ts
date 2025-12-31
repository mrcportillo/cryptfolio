import { getAssetArchiveByUserAssetId } from "@/utils/db-api";

type RouteParams = {
  params: {
    id: string;
  };
};

export async function GET(req: Request, { params }: RouteParams) {
  const { searchParams } = new URL(req.url);
  const pageSize = Number(searchParams.get("pageSize") ?? "100");
  const page = Number(searchParams.get("page") ?? "1");
  const assetId = params.id;

  const jsonList = await getAssetArchiveByUserAssetId(assetId, pageSize, page);

  return Response.json(jsonList);
}
