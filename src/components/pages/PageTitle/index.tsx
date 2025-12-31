import type { PropsWithChildren } from "react";

export default function PageTitle({ children }: PropsWithChildren) {
  return <h1 className="text-primary-950 text-3xl">{children}</h1>;
}
