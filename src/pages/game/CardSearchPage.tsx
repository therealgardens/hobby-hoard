import { useParams } from "react-router-dom";
import { CardSearch } from "@/components/CardSearch";
import type { Game } from "@/lib/game";

export default function CardSearchPage() {
  const { game } = useParams<{ game: Game }>();
  if (!game) return null;
  return (
    <div>
      <h2 className="text-4xl font-display mb-2">Search cards</h2>
      <p className="text-muted-foreground mb-6">
        Look up any card by name or code across the full catalog.
      </p>
      <CardSearch game={game} />
    </div>
  );
}
