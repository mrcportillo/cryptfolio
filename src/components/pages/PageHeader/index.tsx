import type { PropsWithChildren } from "react";

export default function PageHeaeder({ children }: PropsWithChildren) {
  return <div className="mb-2 flex items-center">{children}</div>;
}
