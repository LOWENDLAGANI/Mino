// ── CPU budget ───────────────────────────────────────────────────────────────
// A shared, deliberately tiny signal: "something in Mino needs the machine right
// now, so anything decorative should stand down."
//
// It exists because the alternative is a judgement call baked into each effect.
// The terminal backdrop is a full-screen WebGL shader — expensive enough to be
// felt on a laptop that is already busy — and the moment it is most likely to
// be noticed is exactly when it is least welcome: while a response is streaming
// in, the user is reading. Rather than guess, the page announces the busy window
// and the effect yields.
//
// A counter rather than a boolean, so two things being busy at once cannot
// release each other early. Releasing the backdrop while a second holder is
// still working would reintroduce exactly the lag this is here to prevent.

type Listener = () => void;

let holders = 0;
const listeners = new Set<Listener>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function isBusy(): boolean {
  return holders > 0;
}

/**
 * Announces that the machine is needed, and returns the function that ends it.
 *
 * Return the release function from a `useEffect` cleanup, so a component that
 * unmounts mid-hold does not leak a claim it can no longer hand back.
 */
export function hold(): () => void {
  holders += 1;
  emit();
  let released = false;
  return () => {
    // A double release would drive the count negative and leave the backdrop
    // permanently switched off, so it is refused rather than absorbed.
    if (released) return;
    released = true;
    holders = Math.max(0, holders - 1);
    emit();
  };
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
