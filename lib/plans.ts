// ── Mino subscriptions ──────────────────────────────────────────────────────
// One file holds every paid tier: what it costs, what it unlocks, and the QR a
// buyer scans to pay for it. Adding a plan is a single entry here, and the
// pricing page, the feature table and the payment dialog all follow from it.

/**
 * Where the payment QR lives.
 *
 * A DuitNow QR is a merchant code that accepts any amount, so one static image
 * serves both plans — the exact amount to enter is printed next to it in the
 * payment dialog rather than baked into the code. To give a plan its own QR,
 * drop an image into /public and point that plan's `qr` at it.
 */
const DEFAULT_QR = "/mino-donate-qr.png";

/** Line shown under the QR in the payment dialog. */
const QR_CAPTION = "Scan with your banking app · DuitNow";

export type PlanId = "mini" | "lunar";

export type Plan = {
  id: PlanId;
  name: string;
  /** The name used on buttons and tab labels, e.g. "Upgrade to Lunar". */
  short: string;
  /** Monthly price in ringgit. The single number that decides what is charged. */
  ringgit: number;
  blurb: string;
  /** The plan the page opens on and the one the sidebar advertises. */
  featured: boolean;
  qr: string;
  qrCaption: string;
};

export const PLANS: readonly Plan[] = [
  {
    id: "mini",
    name: "Mino Mini",
    short: "Mini",
    ringgit: 10,
    blurb: "Everything you need to chat",
    featured: false,
    qr: DEFAULT_QR,
    qrCaption: QR_CAPTION,
  },
  {
    id: "lunar",
    name: "Mino Lunar",
    short: "Lunar",
    ringgit: 15,
    blurb: "Maximum access to the whole brain",
    featured: true,
    qr: DEFAULT_QR,
    qrCaption: QR_CAPTION,
  },
] as const;

/** The plan shown first and the one the hero headline describes. */
export const DEFAULT_PLAN: Plan = PLANS.find((plan) => plan.featured) ?? PLANS[0];

/**
 * What each tier unlocks. Read per column, so `free` is what a visitor gets
 * with no plan at all, and a plan never claims something the free tier has.
 */
export const FEATURES: readonly {
  label: string;
  free: boolean;
  mini: boolean;
  lunar: boolean;
}[] = [
  { label: "Access to the newest model", free: true, mini: true, lunar: true },
  { label: "Advanced reasoning", free: false, mini: true, lunar: true },
  { label: "More messages and uploads", free: false, mini: true, lunar: true },
  { label: "Advanced image creation", free: false, mini: true, lunar: true },
  { label: "More memory", free: false, mini: true, lunar: true },
  { label: "Early access to new features", free: false, mini: false, lunar: true },
  { label: "Agent mode with deep research", free: false, mini: false, lunar: true },
] as const;

/** The plan with this id, falling back to the default rather than throwing. */
export function planById(id: PlanId): Plan {
  return PLANS.find((plan) => plan.id === id) ?? DEFAULT_PLAN;
}

/**
 * "RM 10" / "RM 15.50" — ringgit formatted in one place, so the plan tab, the
 * button and the payment dialog can never quote different prices.
 */
export function formatRinggit(value: number): string {
  const amount = Number.isInteger(value) ? String(value) : value.toFixed(2);
  return `RM ${amount}`;
}