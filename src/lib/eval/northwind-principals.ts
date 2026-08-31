// Named Northwind principals for loopback-only ACL demos. Mirrors the
// `principals` block in content/northwind/questions.json; a test keeps the
// two in sync because this module must stay importable in the browser,
// where the questions file cannot be read.
export type NorthwindPrincipal = {
  key: string;
  userId: string;
  roles: string[];
  departments: string[];
};

export const NORTHWIND_PRINCIPALS: NorthwindPrincipal[] = [
  { key: "eng_ic", userId: "eng_ic", roles: ["standard"], departments: ["engineering"] },
  { key: "eng_lead", userId: "eng_lead", roles: ["manager"], departments: ["engineering"] },
  { key: "eng_dir", userId: "eng_dir", roles: ["director"], departments: ["engineering"] },
  { key: "hr_generalist", userId: "hr_generalist", roles: ["standard"], departments: ["hr"] },
  { key: "hr_manager", userId: "hr_manager", roles: ["hr_manager"], departments: ["hr"] },
  { key: "fin_analyst", userId: "fin_analyst", roles: ["standard"], departments: ["finance"] },
  { key: "fin_manager", userId: "fin_manager", roles: ["finance_manager"], departments: ["finance"] },
  { key: "cfo", userId: "cfo", roles: ["executive"], departments: ["executive", "finance"] },
  { key: "sales_rep", userId: "sales_rep", roles: ["standard"], departments: ["sales"] },
  { key: "sales_manager", userId: "sales_manager", roles: ["sales_manager"], departments: ["sales"] },
  { key: "support_agent", userId: "support_agent", roles: ["standard"], departments: ["support"] },
  {
    key: "support_manager",
    userId: "support_manager",
    roles: ["support_manager"],
    departments: ["support"],
  },
  { key: "legal_counsel", userId: "legal_counsel", roles: ["standard"], departments: ["legal"] },
  { key: "ops_coord", userId: "ops_coord", roles: ["standard"], departments: ["operations"] },
  { key: "ops_manager", userId: "ops_manager", roles: ["manager"], departments: ["operations"] },
];
