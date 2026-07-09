import type { PropsWithChildren } from "react";

export default function PageTitle({ children }: PropsWithChildren) {
  return <h1 className="text-3xl text-primary-950">{children}</h1>;
}
