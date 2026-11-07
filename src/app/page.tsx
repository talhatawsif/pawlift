import { Suspense } from "react";
import { AccountMenu } from "@/components/AccountMenu";
import { BottomSheet } from "@/components/BottomSheet";
import { SearchCard } from "@/components/SearchCard";
import { MapView } from "@/components/map/MapView";

export default function Home({
  searchParams,
}: {
  searchParams: Promise<{ demo?: string }>;
}) {
  return (
    <main className="relative h-dvh w-full overflow-hidden">
      <MapView />
      <SearchCard
        account={
          <Suspense fallback={<div className="h-9 w-20" aria-hidden />}>
            <AccountMenu searchParams={searchParams} />
          </Suspense>
        }
      />
      <BottomSheet />
    </main>
  );
}
