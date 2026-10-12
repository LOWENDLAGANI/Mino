// ── Donate ──────────────────────────────────────────────────────────────────
// Everything the donate page needs to show lives here, so filling in real
// details later is a one-file edit: drop your QR in /public under the name in
// DONATE_QR, then fill in the bank fields below. Any field left as an empty
// string is simply not rendered, so a half-filled page still looks finished.

/** Path (in /public) of the bank QR code. */
export const DONATE_QR = "/mino-donate-qr.png";

/** Shown under the QR, e.g. "DuitNow · Maybank". */
export const DONATE_QR_CAPTION = "Scan with your banking app";

export const DONATE_BANK = {
  bank: "",
  holder: "",
  account: "",
  email: "",
} as const;

/** Preset amounts in ringgit. Any amount is allowed via the custom field. */
export const DONATE_PRESETS = [5, 10, 20, 50] as const;
