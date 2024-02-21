import list from "@/services/coin/list";

export async function GET(req, res) {
  const { searchParams } = new URL(req.url);
  const pageSize = searchParams.get("pageSize") || 100;
  const page = searchParams.get("page") || 1;

  const jsonList = await list(pageSize, page);

  return Response.json(jsonList);
}
