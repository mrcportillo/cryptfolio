import type { PropsWithChildren } from "react";

export default function PageContainer({ children }: PropsWithChildren) {
  return (
    <div className="mx-2 my-4 flex flex-col sm:mx-4 md:mx-8 md:my-10 lg:mx-20">
      {children}
    </div>
  );
}
