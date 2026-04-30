export const COLLECTION_CHANGED_EVENT = "tcg:collection-changed";

export function emitCollectionChanged(detail?: { game?: string; cardId?: string }) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(COLLECTION_CHANGED_EVENT, { detail }));
}

export function onCollectionChanged(
  handler: (detail: { game?: string; cardId?: string } | undefined) => void,
) {
  if (typeof window === "undefined") return () => {};
  const listener = (e: Event) => handler((e as CustomEvent).detail);
  window.addEventListener(COLLECTION_CHANGED_EVENT, listener);
  return () => window.removeEventListener(COLLECTION_CHANGED_EVENT, listener);
}
