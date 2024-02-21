"use client"; // Error components must be Client Components

import { useEffect } from "react";
import PageContainer from "./components/PageContainer";

export default function Error({ error, reset }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <PageContainer>
      <h2>Ups!</h2>
      <button className="bg-slate-300 px-2 py-1 mt-6 rounded-sm" onClick={() => reset()}>
        Try again
      </button>
    </PageContainer>
  );
}
