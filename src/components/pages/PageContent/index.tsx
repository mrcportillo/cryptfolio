import type { PropsWithChildren } from "react";

export default function PageContent({ children }: PropsWithChildren) {
  return <div className="my-4">{children}</div>;
}
