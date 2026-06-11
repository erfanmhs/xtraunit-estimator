/**
 * Central place for app-wide settings and labels.
 *
 * Keeping these in one file means you change the app name, tagline, or company
 * details here once, instead of hunting through many files. Brand facts mirror
 * assets/company-profile.json.
 */
export const siteConfig = {
  name: "XtraUnit Estimator",
  company: "XtraUnit",
  parentCompany: "DOTZ",
  tagline: "Maximizing Space. Multiplying Value.",
  positioning: "Design · Build · Develop",
  licenseText: "Licensed & Bonded — CA LIC #1033830",
  website: "https://xtraunit.com",
  address: "15500 Erwin St #2002, Van Nuys, CA 91411",
  phone: "+1 310 749 7999",
  email: "info@xtraunit.com",
  hours: "Mon–Fri, 8:00 AM – 7:00 PM",
  description:
    "Construction plan estimating tool — turn plans into priced scopes and proposals.",
} as const;
