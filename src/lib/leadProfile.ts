/** How a lead is described in the client's leads table: the kind of organization and the seniority of the role.
 *  Both are worked out from free text (company name, job title), so they are a best guess, and the page says so. */

/** Seniority from a job title. Order matters: "Director of Engineering" is a director. */
export const SENIORITY: [string, RegExp][] = [
  ["C-suite and owners", /\b(chief|ceo|cfo|coo|cto|cio|ciso|president|owner|founder|principal|partner|gm|general manager)\b/i],
  ["VPs and directors", /\b(vice president|vp|svp|evp|avp|director|head of)\b/i],
  ["Managers", /\b(manager|supervisor|superintendent|lead)\b/i],
];
export const SENIORITY_ORDER = [...SENIORITY.map(([s]) => s), "Engineers, analysts and specialists", "Not given"];
export const seniorityOf = (t: string | null) =>
  !t?.trim() || /^(n\/?a|-)$/i.test(t.trim()) ? "Not given" : SENIORITY.find(([, r]) => r.test(t))?.[0] ?? "Engineers, analysts and specialists";

export const UTILITY = "Utilities";
export const COMPANY_TYPES = [UTILITY, "Government, regulators and research", "Consultants and engineering firms", "Technology and other companies", "Not given"];

// Utilities by name: North American investor-owned, public power, co-ops, grid operators and their associations.
const UTILITY_NAMES = /\b(utilit(y|ies)|public power|public utility|pud|municipal|co-?op|cooperative|emc|remc|electric (company|co|coop|membership|power|board|department|system|utility|service)|power (company|co|district|authority|board|cooperative)|light (and|&) power|gas (and|&) electric|g&e|edison|con ?ed|hydro|iso-?ne|nyiso|caiso|ercot|miso|pjm|spp|tva|bpa|wapa|nypa|lipa|duke energy|dominion|ameren|exelon|comed|peco|pseg|xcel|entergy|southern company|georgia power|alabama power|mississippi power|fpl|florida power|nextera|aep|appalachian power|firstenergy|ppl|eversource|national grid|avangrid|consumers energy|dte|centerpoint|oncor|evergy|alliant|we energies|wec energy|nipsco|pepco|bge|delmarva|sdg&e|sce|pacificorp|puget sound energy|portland general|idaho power|nv energy|arizona public service|aps|srp|salt river project|tucson electric|el paso electric|black hills|northwestern energy|otter tail|midamerican|hawaiian electric|ladwp|smud|austin energy|cps energy|ouc|jea|lcec|alectra|fortis|emera|nova scotia power|atco|enmax|epcor|saskpower|ontario power generation|opg|avista|liberty utilities|unitil|green mountain power|central hudson|orange (and|&) rockland|nyseg|rochester gas|duquesne light|lg&e|kentucky utilities|basin electric|tri-state|great river energy|oglethorpe|seminole electric|old dominion electric|nreca|appa|eei|ercot|sempra|pg&e|socalgas|southwest gas|spire|nicor|atmos energy|washington gas|piedmont natural gas|questar|cleco|santee cooper|jemena|ausgrid|eskom|enel|iberdrola|e\.on|rwe|vattenfall|edf|uk power networks|scottish power)\b/i;
const GOVERNMENT = /\b(city of|county|state of|town of|village of|department|dept\.?|commission|puc|psc|ferc|nerc|doe|federal|government|agency|ministry|national lab(oratory)?|laboratory|nrel|ornl|pnnl|lbnl|epri|university|college|institute|army|navy|air force|corps of engineers)\b/i;
const CONSULTING = /\b(consult\w*|advis\w*|icf|accenture|deloitte|pwc|kpmg|ey|ernst|mckinsey|bcg|bain|guidehouse|black (&|and) veatch|burns (&|and) mcdonnell|1898|west monroe|e source|wood mackenzie|leidos|jacobs|aecom|stantec|hdr|power engineers|pole ?star|sargent (&|and) lundy|engineers?|engineering)\b/i;

export const companyTypeOf = (c: string | null) => {
  const name = c?.trim();
  if (!name || /^(n\/?a|none|-|self|freelance|retired)$/i.test(name)) return "Not given";
  if (UTILITY_NAMES.test(name)) return UTILITY;
  if (GOVERNMENT.test(name)) return "Government, regulators and research";
  if (CONSULTING.test(name)) return "Consultants and engineering firms";
  return "Technology and other companies";
};
