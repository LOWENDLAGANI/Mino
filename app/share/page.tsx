import MaintenanceGate from "@/components/MaintenanceGate";
import ShareView from "@/components/ShareView";

// The conversation lives in the fragment, which is never sent to a server, so
// there is nothing here to render server-side — but metadata still matters: a
// shared link should describe itself and stay out of search indexes, because a
// public conversation was shared with one person, not with Google. The content
// being in the fragment means a crawler would see an empty page anyway; the
// robots tag says so explicitly rather than leaving it to chance.
export const metadata = {
  title: "A shared chat — Mino",
  description: "A conversation shared from Mino. The text travels inside the link itself.",
  robots: { index: false, follow: false },
};

export default function SharePage() {
  return (
    <MaintenanceGate>
      <ShareView />
    </MaintenanceGate>
  );
}
