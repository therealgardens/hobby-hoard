export interface CollectionChangedDetail {
  game: string;
  cardId: string;
  card?: {
    set_id: string | null;
    set_name: string | null;
    code: string | null;
  };
}

const COLLECTION_CHANGED = "tcg:collection-changed";

export function emitCollectionChanged(detail: CollectionChangedDetail) {
  window.dispatchEvent(new CustomEvent(COLLECTION_CHANGED, { detail }));
}

export function onCollectionChanged(
  handler: (detail: CollectionChangedDetail) => void,
): () => void {
  const listener = (e: Event) => handler((e as CustomEvent<CollectionChangedDetail>).detail);
  window.addEventListener(COLLECTION_CHANGED, listener);
  return () => window.removeEventListener(COLLECTION_CHANGED, listener);
}
