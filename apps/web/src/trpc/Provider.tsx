"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TRPCClientError } from "@trpc/client";
import { httpBatchStreamLink } from "@trpc/client";
import { useState, type PropsWithChildren } from "react";
import superjson from "superjson";
import { trpc } from "./client";

const retryFn = (failureCount: number, error: unknown): boolean => {
  if (error instanceof TRPCClientError) {
    const status = error.data?.httpStatus as number | undefined;
    if (status !== undefined && status >= 400 && status < 500) return false;
  }
  return failureCount < 3;
};

export const TrpcProvider = ({ children }: PropsWithChildren) => {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { staleTime: 5_000, retry: retryFn } },
      }),
  );

  const [trpcClient] = useState(() =>
    trpc.createClient({
      links: [
        httpBatchStreamLink({
          url: "/api/trpc",
          transformer: superjson,
        }),
      ],
    }),
  );

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </trpc.Provider>
  );
};
