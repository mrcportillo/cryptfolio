import list from "@/services/coin/list";
import { getCurrentUser } from "@/lib/auth";
import { getRequestIdentifier, rateLimit } from "@/lib/rate-limit";
import { parsePagination } from "@/lib/pagination";

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const rate = rateLimit(getRequestIdentifier(req, user.id), 60, 60_000);

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

  try {
    const jsonList = await list(pageSize, page);
    return Response.json(jsonList);
  } catch {
    return Response.json(
      { error: "Coin data is temporarily unavailable." },
      { status: 503 },
    );
  }
}
