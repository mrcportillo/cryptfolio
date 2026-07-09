import {
  getAssetArchiveByUserAssetId,
  getAssetById,
} from "@/utils/db-api";
import { getCurrentUser } from "@/lib/auth";
import { getRequestIdentifier, rateLimit } from "@/lib/rate-limit";
import { parsePagination } from "@/lib/pagination";

type RouteParams = {
  params: Promise<{
    id: string;
  }>;
};

export async function GET(req: Request, { params }: RouteParams) {
  const user = await getCurrentUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const rate = rateLimit(getRequestIdentifier(req, user.id), 120, 60_000);

  if (!rate.allowed) {
    return Response.json(
      { error: "Too many requests" },
      {
        status: 429,
        headers: { "Retry-After": String(rate.retryAfterSeconds) },
      },
    );
  }

  const { searchParams } = new URL(req.url);
  const { pageSize, page } = parsePagination(searchParams);
  const { id: assetId } = await params;

  try {
    const asset = await getAssetById(assetId, user.id);
    if (!asset) {
      return Response.json({ error: "Asset not found" }, { status: 404 });
    }

    const jsonList = await getAssetArchiveByUserAssetId(
      user.id,
      assetId,
      pageSize,
      page,
    );

    return Response.json(jsonList);
  } catch {
    return Response.json(
      { error: "Archive data is temporarily unavailable." },
      { status: 503 },
    );
  }
}
