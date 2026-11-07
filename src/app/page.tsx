import { BottomSheet } from "@/components/BottomSheet";
import { SearchCard } from "@/components/SearchCard";
import { MapView } from "@/components/map/MapView";

export default function Home() {
  return (
    <main className="relative h-dvh w-full overflow-hidden">
      <MapView />
      <SearchCard />
      <BottomSheet />
    </main>
  );
}
