 export type Niche = "finance" | "education" | "entertainment" | "general";

export const NICHE_GUIDANCE: Record<Niche, string> = {
  finance:
    "Niche: personal finance and markets. Educational, fact-based, no hype. Never give personalized investment advice, never promise returns or guarantee outcomes. Say plainly that this is general education, not financial advice, in the description and once near the end of the narration.",
  education:
    "Niche: education and explainers. Teach one clear idea: open with a surprising question, build intuition, give one concrete example, finish with a short recap. Prioritize accuracy over drama and avoid claims you cannot support.",
  entertainment:
    "Niche: entertainment and pop culture. High energy, story-driven, strong emotional hooks and humor. Do not state unverified rumors as fact and do not make defamatory claims about real people.",
  general:
    "Niche: general interest. Pick whatever topic has the strongest curiosity gap and widest appeal, and keep every claim defensible.",
};

export function nicheGuidance(niche: string, styleNotes: string | null): string {
  const base = NICHE_GUIDANCE[(niche as Niche) in NICHE_GUIDANCE ? (niche as Niche) : "general"];
  const notes = styleNotes?.trim();
  return notes ? `${base}\nChannel-specific style notes from the owner: ${notes}` : base;
}
