export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 100;

export type Pagination = {
  page: number;
  pageSize: number;
  skip: number;
};

function parsePositiveInteger(value: string | null, fallback: number) {
  if (!value || !/^\d+$/.test(value)) {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function parsePagination(searchParams: URLSearchParams): Pagination {
  const page = parsePositiveInteger(searchParams.get("page"), 1);
  const requestedPageSize = parsePositiveInteger(
    searchParams.get("pageSize"),
    DEFAULT_PAGE_SIZE,
  );
  const pageSize = Math.min(requestedPageSize, MAX_PAGE_SIZE);

  return {
    page,
    pageSize,
    skip: (page - 1) * pageSize,
  };
}
