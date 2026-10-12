// ── Delete my data ───────────────────────────────────────────────────────────
// The visitor's own eraser. It clears every local table, tells the account
// sync that these chats are gone so the next pull cannot hand them back, and
// removes this identity's nodes from the database with the visitor's own
// token — the rules already allow an owner to write their own subtree, so
// this needs no credential and no admin involvement.
//
// One thing it deliberately keeps: the subscription. A paid plan belongs to
// the person, not to the chat history, and an eraser that silently ate a
// purchase would be the kind of "privacy" feature that generates support mail.

import { remove, ref } from "firebase/database";
import { db } from "./db";
import { firebaseConfigured, getServices, syncChatWipe } from "./firebaseHistory";

export interface DeleteDataResult {
  /** The local wipe always runs; false only if Dexie itself refused. */
  local: boolean;
  /** How many remote paths were removed, for the sentence in Settings. */
  remote: number;
}

export async function deleteAllMyData(): Promise<DeleteDataResult> {
  // The deletion marker goes down before the local rows vanish: if the clear
  // is interrupted halfway, the next sync must not restore what was being
  // deleted into a browser that just asked for it to be gone.
  await syncChatWipe().catch(() => undefined);

  // Dexie's transaction type takes at most five tables, so the wipe is two
  // transactions rather than one. The conversations go first — they are the
  // thing being deleted — and the two bookkeeping tables follow.
  await db.transaction(
    "rw",
    db.chats,
    db.messages,
    db.folders,
    db.memories,
    db.scheduled,
    async () => {
      await db.messages.clear();
      await db.chats.clear();
      await db.folders.clear();
      await db.memories.clear();
      await db.scheduled.clear();
    }
  );
  await db.transaction("rw", db.trash, async () => {
    await db.trash.clear();
  });

  let remote = 0;
  if (firebaseConfigured) {
    const current = await getServices();
    // Anonymous or signed in, the data lives under whatever uid this browser
    // holds — and the rules let that uid clear exactly its own paths.
    const user = current?.user ?? (await current?.ensureUser());
    if (current && user) {
      for (const path of [
        `users/${user.uid}`,
        `admin/registry/${user.uid}`,
        `usage/${user.uid}`,
        `push/subscriptions/${user.uid}`,
      ]) {
        try {
          await remove(ref(current.database, path));
          remote += 1;
        } catch {
          // Rules not republished, offline, or already gone. The local wipe
          // stands on its own; a partial remote removal is reported as such.
        }
      }
    }
  }

  return { local: true, remote };
}
