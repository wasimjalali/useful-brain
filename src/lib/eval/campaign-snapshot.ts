export type CampaignKey = "baseline" | "pass1" | "final";

export type CampaignCategoryId =
  | "factual"
  | "trap"
  | "permission"
  | "unanswerable"
  | "multi_hop";

export type CampaignCategory = {
  id: CampaignCategoryId;
  label: string;
  passed: number;
  scored: number;
};

export type CampaignFailure = {
  id: string;
  category: CampaignCategoryId;
  detail: string;
};

export type CampaignRun = {
  key: CampaignKey;
  label: string;
  date: string;
  passed: number;
  scored: number;
  passRate: number;
  note: string;
  categories: CampaignCategory[];
  failures: CampaignFailure[];
};

const CATEGORY_LABEL: Record<CampaignCategoryId, string> = {
  factual: "Factual",
  trap: "Trap",
  permission: "Permission",
  unanswerable: "Unanswerable",
  multi_hop: "Multi-hop",
};

function category(
  id: CampaignCategoryId,
  passed: number,
  scored: number,
): CampaignCategory {
  return { id, label: CATEGORY_LABEL[id], passed, scored };
}

export const NORTHWIND_CAMPAIGN_RUNS: CampaignRun[] = [
  {
    key: "baseline",
    label: "Baseline",
    date: "2026-08-30",
    passed: 77,
    scored: 107,
    passRate: 0.72,
    note: "13 permission questions could not be scored.",
    categories: [],
    failures: [],
  },
  {
    key: "pass1",
    label: "Pass 1",
    date: "2026-08-31",
    passed: 95,
    scored: 120,
    passRate: 0.792,
    note: "All 120 scored. Multi-hop collapsed to 0/10.",
    categories: [
      category("factual", 59, 70),
      category("trap", 17, 17),
      category("permission", 10, 13),
      category("unanswerable", 9, 10),
      category("multi_hop", 0, 10),
    ],
    failures: [],
  },
  {
    key: "final",
    label: "Latest",
    date: "2026-08-31",
    passed: 114,
    scored: 120,
    passRate: 0.95,
    note: "Locked GLM 5.3 Flash run. Six remaining failures.",
    categories: [
      category("factual", 66, 70),
      category("trap", 17, 17),
      category("permission", 12, 13),
      category("unanswerable", 10, 10),
      category("multi_hop", 9, 10),
    ],
    failures: [
      {
        id: "q028",
        category: "factual",
        detail:
          "Twin-document citation. Grounded answer cited nw_support_dsar_process instead of nw_legal_privacy_policy.",
      },
      {
        id: "q073",
        category: "permission",
        detail:
          "Expected insufficient_evidence. Answered from an allowed neighbor document.",
      },
      {
        id: "q088",
        category: "multi_hop",
        detail:
          "Missing the second-hop citation for nw_sales_referral_program.",
      },
      {
        id: "q100",
        category: "factual",
        detail: "Named-entity lookup. Model returned insufficient_evidence.",
      },
      {
        id: "q105",
        category: "factual",
        detail: "Named-entity lookup. Model returned insufficient_evidence.",
      },
      {
        id: "q110",
        category: "factual",
        detail:
          "Identifier lookup. Model abstained with evidence in retrieval.",
      },
    ],
  },
];

export const NORTHWIND_CAMPAIGN = {
  title: "Northwind live battery",
  model: "@cf/zai-org/glm-5.3-flash",
  questions: 120,
  documents: 65,
  latestKey: "final" as const,
  retrieval: {
    recallAt3: 0.912,
    mrr: 0.825,
    ndcg: 0.837,
    liveRetrievedRecall: 0.974,
    aclLeaks: 0,
  },
  runs: NORTHWIND_CAMPAIGN_RUNS,
};

export function campaignRun(key: CampaignKey): CampaignRun {
  const run = NORTHWIND_CAMPAIGN_RUNS.find((item) => item.key === key);
  if (!run) {
    throw new Error(`Unknown campaign run: ${key}`);
  }
  return run;
}

export function formatPassRate(rate: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "percent",
    maximumFractionDigits: rate >= 0.95 ? 0 : 1,
  }).format(rate);
}
