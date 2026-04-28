export type Game = "pokemon" | "onepiece";

const KEY = "tcg.activeGame";

export function getActiveGame(): Game | null {
  const v = localStorage.getItem(KEY);
  return v === "pokemon" || v === "onepiece" ? v : null;
}

export function setActiveGame(g: Game) {
  localStorage.setItem(KEY, g);
}

export function clearActiveGame() {
  localStorage.removeItem(KEY);
}

export const GAME_LABEL: Record<Game, string> = {
  pokemon: "Pokémon",
  onepiece: "One Piece",
};
