import { getAssetArchiveByUserAssetId } from "@/utils/db-api";

export async function GET(req, { params }) {
  const { searchParams } = new URL(req.url);
  const pageSize = searchParams.get("pageSize") || 100;
  const page = searchParams.get("page") || 1;
  const assetId = params.id;

  const jsonList = await getAssetArchiveByUserAssetId(assetId, pageSize, page);

  return Response.json(jsonList);
}
