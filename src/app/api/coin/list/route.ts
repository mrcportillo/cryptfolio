import list from "@/services/coin/list";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const pageSize = Number(searchParams.get("pageSize") ?? "100");
  const page = Number(searchParams.get("page") ?? "1");

  const jsonList = await list(pageSize, page);

  return Response.json(jsonList);
}
