// Business constants. Statuses were simplified in Sprint 4; the service catalog
// and rate card moved to the database (see commercial.rs).

/** Proposal statuses (Sprint 4 clean-up). A proposal is won once both
 * parties have signed it; delivery (kickoff, service started) lives on the
 * agreement. Rust mirrors this list in commercial.rs. */
export const STATUSES = [
  "Proposal Request Received",
  "Drafting",
  "In Internal Review",
  "Sent to Client",
  "Signed by Client",
  "Signed by Both Parties",
  "Lost",
  "Withdrawn",
];

export const WIN_REASONS = [
  "Client converted",
  "Price was competitive",
  "Referral / existing relationship",
  "Better service fit",
  "Fast turnaround",
  "Other",
];

export const LOSS_REASONS = [
  "Price too high",
  "Competitor selected",
  "No budget approved",
  "Service not needed",
  "Client unresponsive",
  "Timeline mismatch",
  "Other",
];

// `c` is the text/dot color used at rest; `ch` (chart) is a slightly punchier
// variant for chart series and the small status dots — both are shown only as
// a colored dot + plain-text label (see statusDot() in utils.ts), never as a
// filled pill background, so there's no separate bg/border pair to maintain.
export interface StatusStyle { c: string; ch?: string }

export const ST: Record<string, StatusStyle> = {
  "Proposal Request Received": { c: "#6D28D9", ch: "#8B5CF6" },
  "Drafting": { c: "#1D4ED8", ch: "#3B82F6" },
  "In Internal Review": { c: "#92400E", ch: "#F59E0B" },
  "Sent to Client": { c: "#C2410C", ch: "#F97316" },
  "Signed by Client": { c: "#0F766E", ch: "#14B8A6" },
  "Signed by Both Parties": { c: "#166534", ch: "#22C55E" },
  "Lost": { c: "#991B1B", ch: "#EF4444" },
  "Withdrawn": { c: "#6B7280", ch: "#94A3B8" },
};

// Categorical chart palette — refined/muted rather than neon, but still needs
// enough distinct hues to stay readable across up to 10 data series.
export const CC = ["#3D64C9", "#7C6FCB", "#3D9E8F", "#C68A3D", "#C15B4C", "#4A87AD", "#4F8F63", "#A87B3E", "#6B6FB8", "#B0578C"];

// ── Work queue (Pending tab) ──
export const WQ_STATUSES = [
  "Proposal Request Received",
  "Drafting",
  "In Internal Review",
];

export interface WqCfgEntry { step: number; c: string; ch?: string; label: string }

export const WQ_CFG: Record<string, WqCfgEntry> = {
  // Same colours as these statuses everywhere else (ST above).
  "Proposal Request Received": { step: 1, ...ST["Proposal Request Received"], label: "Request received" },
  "Drafting": { step: 2, ...ST["Drafting"], label: "Drafting" },
  "In Internal Review": { step: 3, ...ST["In Internal Review"], label: "In review" },
};

// ── Agreements ──
export const AGR_STATUSES = [
  "In Preparation",
  "Client Review",
  "Client Signature",
  "MENA Signature",
  "Signed",
  "On Hold",
  "Canceled",
];

/** Where delivery of a signed agreement stands. "Active" agreements make a
 * company an active client and count towards MRR. */
export const SERVICE_STATUSES = ["Not started", "Kickoff scheduled", "Active", "Ended"] as const;

export const AGR_TYPES = [
  "Workforce",
  "Administration",
  "Accountancy",
  "Company Maintenance",
  "Company Constitution",
  "Consultancy",
  "Other",
];

export const AGR_ST: Record<string, StatusStyle> = {
  "In Preparation": { c: "#92400E" },
  "Client Review": { c: "#C2410C" },
  "Client Signature": { c: "#0F766E" },
  "MENA Signature": { c: "#0369A1" },
  "Signed": { c: "#14532D" },
  "On Hold": { c: "#6B7280" },
  "Canceled": { c: "#991B1B" },
};

// ── HubSpot deal-stage mapping ──
export const HS_STAGE_MAP: Record<string, string> = {
  "Proposal Request Received": "Appointment Scheduled",
  "Drafting": "Qualified To Buy",
  "In Internal Review": "Qualified To Buy",
  "Sent to Client": "Presentation Scheduled",
  "Signed by Client": "Decision Maker Bought-In",
  "Signed by Both Parties": "Closed Won",
  "Lost": "Closed Lost",
  "Withdrawn": "Closed Lost",
};

export const LEAD_SOURCES = ["Referral", "Recurring client", "LinkedIn", "Website", "Inbound enquiry", "Outbound", "Event", "Partner", "Other"];

// ── Pricing engine (rate card) ──
export interface PricingTranche { label: string; noCommMin: number; noCommMax: number; commMin: number | null; commMax: number | null; volMin?: number }
export interface PricingPackage { name: string; min: number; max: number }
export interface PricingBundle { name: string; price: number }
export interface PricingService {
  name: string; cat: string; matchTypes?: string[];
  hasTranches?: boolean; trancheLabel?: string; tranches?: PricingTranche[];
  hasPackages?: boolean; packages?: PricingPackage[];
  bundles?: PricingBundle[];
  oneTime?: boolean;
  noCommMin?: number; noCommMax?: number; commMin?: number; commMax?: number;
  /** The usual price inside the range (Constitution 55,000 of 45,000–66,000). */
  standard?: number;
  /** Priced as a percentage (Recruitment: 10% of the annual package). */
  percent?: { min: number; standard: number; max: number; basis: string };
  /** One-time fees paid in stages. */
  milestones?: string[];
  /** Employee bands shown in the proposal around the client's band. */
  showBands?: number;
  /** The price is per person per month (Workforce). */
  perPerson?: boolean;
  minimumMonths?: number;
  /** Rows a proposal lists for this service (Accountancy rows, Recruitment staff types). */
  rows?: { label: string; min: number; standard: number; max: number; percent?: boolean; counts?: boolean }[];
  /** Priced per country (Mobilization): the proposal lists one row per country. */
  perCountry?: boolean;
}
export interface PricingAddon { svc: string; action: string; fee: string }

// The rate card itself lives in the database (rate_cards), seeded from
// src-tauri/src/catalog_seed.json and edited under Services.
