export async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const headers: HeadersInit = {
    accept: "application/json",
    "accept-language": "en-US,en;q=0.9",
    "x-cg-demo-api-key": process.env.COIN_API_KEY,
    ...options?.headers,
  };

  const response = await fetch(url, { ...options, headers });
  if (!response.ok) {
    console.error("Error requesting coin API:", response.statusText);
    throw new Error(response.statusText);
  }
  return (await response.json()) as T;
}
