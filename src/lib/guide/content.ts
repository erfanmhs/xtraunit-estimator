/**
 * The in-app guide, as data. One entry per screen: what the screen is for,
 * the steps in order with the exact button names, and what "done" looks
 * like. The Guide panel renders whichever entry matches the current route;
 * the same six stages appear as the journey strip so a first-time user can
 * read ahead.
 *
 * Wording rule: name the button as it appears on screen, in quotes. If a
 * button is renamed, this file is the second place to change it.
 */

export type GuideKey =
  | "projects"
  | "new"
  | "project"
  | "takeoff"
  | "scope"
  | "pricing"
  | "estimate"
  | "proposal"
  | "cost-database"
  | "settings";

export type GuideStep = {
  /** What to do — starts with a verb. */
  do: string;
  /** Where the control is / what happens; optional second line. */
  note?: string;
};

export type GuideEntry = {
  key: GuideKey;
  title: string;
  /** One sentence: why this screen exists. */
  purpose: string;
  steps: GuideStep[];
  /** What the screen looks like when you're done here. */
  done: string;
  /** One thing people get wrong, or the shortcut worth knowing. */
  tip?: string;
  /** Where the flow goes next (label only; the panel resolves the link). */
  next?: { key: GuideKey; label: string };
};

/** The six stages in order — the journey strip. `project` is the hub (plans). */
export const JOURNEY: { key: GuideKey; label: string; short: string }[] = [
  { key: "project", label: "Plans", short: "Upload the plans" },
  { key: "takeoff", label: "Takeoff", short: "Measure the drivers" },
  { key: "scope", label: "Scope", short: "AI writes the scope" },
  { key: "pricing", label: "Pricing", short: "Price and confirm" },
  { key: "estimate", label: "Estimate", short: "Markups → bid" },
  { key: "proposal", label: "Proposal", short: "Send to the client" },
];

export const GUIDE: Record<GuideKey, GuideEntry> = {
  projects: {
    key: "projects",
    title: "Projects",
    purpose: "Every job you bid is a project. The six dots on a card show how far along it is.",
    steps: [
      { do: "Click “+ New project” (top right).", note: "Name, client, address, type — one short form." },
      { do: "Open a project card to get to its home page.", note: "Plans go in there; the six stages follow." },
      { do: "To move a card, tap “Reorder” above the list (or hold a card → “Reorder projects”), drag it, then tap Done.", note: "Holding a card also gives Edit, Duplicate, Archive and Delete." },
    ],
    done: "A card for the job, with 0 of 6 dots lit. Time to upload plans.",
    tip: "Start with a small job you already priced by hand. You'll know whether the numbers feel right.",
    next: { key: "new", label: "Create the project" },
  },

  new: {
    key: "new",
    title: "New project",
    purpose: "Just enough to name the job. Everything else comes from the plans.",
    steps: [
      { do: "Type the project name, the client, the address and the type.", note: "The client name and address print on the proposal." },
      { do: "Click “Create project”.", note: "You land on the project's home page." },
    ],
    done: "The project's home page, with an empty plans box waiting.",
    next: { key: "project", label: "Upload the plans" },
  },

  project: {
    key: "project",
    title: "Project home · Plans",
    purpose: "Plans in first. Then the six stages run left to right — Takeoff, Scope, Pricing, Estimate, Proposal.",
    steps: [
      { do: "Click “＋ Upload or drop a plan PDF” and pick the plan set.", note: "On a phone you can also “Photograph a sheet” — the camera opens, the photo becomes a one-page plan." },
      { do: "Sort the pages when asked: floor plans, elevations, sections, site plan.", note: "The app names each sheet. Keep the ones that carry quantities; skip title sheets and details." },
      { do: "Open the takeoff: “Takeoff” in the sidebar (bottom bar on a phone), or the sheet itself.", note: "That's where you set the scale and measure." },
      { do: "Come back here any time — the “Next up” box says what to do next.", note: "A green dot on a stage tab means that stage is done; amber means started." },
    ],
    done: "At least one plan uploaded and its pages sorted. The Takeoff tab is live.",
    tip: "One PDF with all the sheets is fine. Up to 50 MB per file.",
    next: { key: "takeoff", label: "Set the scale and measure" },
  },

  takeoff: {
    key: "takeoff",
    title: "Takeoff",
    purpose: "Measure the few numbers that drive the job. The AI scopes everything else from them.",
    steps: [
      { do: "Set the scale first: the “Scale” box in the toolbar (e.g. 1/4″ = 1′-0″).", note: "No scale printed? Use “Calibrate”: tap both ends of a dimension you know and type its length. Every sheet needs a scale before it saves a measurement." },
      { do: "Pick a tool: “Area” for floors, roofs and slabs · “Line” or “Wall” for walls, footings, curbs · “Count” for doors, windows, fixtures · “Volume” for excavation and concrete.", note: "“Polyline” for a run of connected walls. “Select” to pick something you already drew; “Pan” to move the sheet with one finger." },
      { do: "Each tool gets its own layer. Switching tools opens the layer box with a name like “Layer 3” selected — type a real name (“Exterior walls”) or tap Done to keep the number.", note: "A layer holds one kind of measurement, so areas and counts never mix. To keep adding to an earlier layer of the same kind, pick it under “Continue a layer”." },
      { do: "Counting many of the same thing? Tap one, then “Find all like this”.", note: "A dashed box appears around your last marker — size it with − / + until it just covers the symbol, then “Find”. Strong matches come back ticked, unsure ones grey; tap any to flip it, then “Add”. One Undo takes them all back." },
      { do: "Want a second opinion? “AI count check” reads the whole sheet and lists what it sees — doors, windows, fixtures — next to your counts.", note: "About two cents a sheet. “Place as markers” drops a kind onto the sheet as its own layer, which you can then move or delete." },
      { do: "Tap the corners. On a phone the crosshair floats above your finger — line it up, then lift.", note: "Two fingers pan and zoom, never place a point. Hold a point for move / delete. When the last corner is in, tap “✓ Close shape” (or “✓ Finish” for a line)." },
      { do: "Name each measurement the way you'd say it: “Main floor area”, “Exterior walls”, “Kitchen windows”.", note: "The AI reads the names when it writes the scope. Good names → good scope." },
      { do: "Measure 5–10 drivers, not everything.", note: "Floor area · exterior wall length · roof area · window and door counts · kitchens and baths · excavation. Stop there." },
    ],
    done: "A short list of named measurements on each sheet that matters. The Takeoff dot turns green.",
    tip: "“« Panel” opens the list of everything measured on the sheet; “Show legend” prints the totals on the sheet itself.",
    next: { key: "scope", label: "Generate the scope" },
  },

  scope: {
    key: "scope",
    title: "Scope of Work",
    purpose: "The AI reads your plans and measurements and writes the scope by trade — the way a sub bids it and a client reads it.",
    steps: [
      { do: "Wait for the sheets to prepare themselves the first time (a status line above the scope says so).", note: "A minute or two, once per upload. If it says failed, click “Retry”." },
      { do: "Choose “Full building” or “Specific trades” (then tick the trades).", note: "Full building for a whole job; specific trades when you're bidding part of it." },
      { do: "Click “Generate Scope of Work”.", note: "Two to five minutes; the progress line tells you what it's doing. You can leave the page — it keeps working." },
      { do: "Open each trade and read the lines. Confirm what's right, delete what doesn't apply, add what's missing.", note: "Every line says where it came from (measurement, plan note, assumption)." },
      { do: "Answer the questions under “What to review”.", note: "Each answer tightens the scope. “Regenerate Scope” if you changed a lot." },
    ],
    done: "A scope by trade with most lines confirmed and no open gaps that matter.",
    tip: "The AI cost line under the button shows what this month's runs cost. A full-building scope is about a dollar.",
    next: { key: "pricing", label: "Price the lines" },
  },

  pricing: {
    key: "pricing",
    title: "Pricing",
    purpose: "Put a direct cost on every scope line — labor, material, sub, equipment, other. Nothing counts until you confirm it.",
    steps: [
      { do: "Click “Suggest prices with AI”.", note: "Fills the unpriced lines from your cost database and past jobs. Each suggestion stays a suggestion until you confirm it." },
      { do: "Tap a line to edit the five cells. Per unit when the line has a quantity, lump sum otherwise.", note: "Cells take formulas: 2.5*1.1, (100+50)/2." },
      { do: "Tap “Confirm” on each line you agree with — or “Confirm all” at the top of the table.", note: "Only confirmed lines count as done — watch “Confirmed” vs “Projected” at the top." },
      { do: "Have a sub's quote? “+ Add Quote” → upload the PDF or photograph it.", note: "The AI reads the total and the trades, then spreads the amount across that trade's lines." },
      { do: "Exclusions live at the bottom — lines you're not bidding, kept with their numbers.", note: "They print on the proposal as exclusions." },
    ],
    done: "Every line confirmed (or excluded). Confirmed equals Projected.",
    tip: "Your first project is slow here. The second is fast — the cost database remembers.",
    next: { key: "estimate", label: "Set the markups" },
  },

  estimate: {
    key: "estimate",
    title: "Estimate",
    purpose: "Direct cost through your markups — that's the bid number.",
    steps: [
      { do: "Set “Contingency”, “Insurance” and “Overhead & Profit” as percentages.", note: "They start from the defaults in Settings. Each applies to the running total above it." },
      { do: "Type the building square footage.", note: "Gives the $/SF line — the fastest sanity check against jobs you've done." },
      { do: "Read the waterfall top to bottom: direct cost → contingency → insurance → overhead & profit = bid.", note: "" },
      { do: "Need it in a spreadsheet? “Export to Excel (CSV)”.", note: "Every line plus the waterfall." },
    ],
    done: "A bid number you believe, and a $/SF that lines up with experience.",
    tip: "If the $/SF looks wrong, the problem is almost always in Pricing, not here.",
    next: { key: "proposal", label: "Build the proposal" },
  },

  proposal: {
    key: "proposal",
    title: "Proposal",
    purpose: "The client-ready document: letter, scope by trade, price options, timeline, terms — and a link the client can accept in.",
    steps: [
      { do: "Click “Draft summary with AI” for the executive summary.", note: "Edit it in the box; “Re-draft summary with AI” starts over." },
      { do: "Fill the letter: proposal date, pricing valid through, anticipated start, duration.", note: "Company name, license and closing line come from Settings." },
      { do: "Add timeline milestones and, if you offer choices, price options (“Recommended” / “Enhanced”).", note: "" },
      { do: "Check the preview. Print, or Save as PDF from the print dialog.", note: "Every page prints; the browser's print button works." },
      { do: "For work on someone's home, keep “Home improvement contract” ticked under 05 · Contract and fill it in: start and completion dates, the down payment (the editor shows the legal cap), and the phases of the payment schedule until it adds up.", note: "That section makes the accepted proposal a California home improvement contract — the lien warning, right to cancel and insurance statements print automatically. Turn it off for commercial work." },
      { do: "Click “Publish client link” and send the link.", note: "The client reads it on their phone and can accept in the document. After edits, “Update client link”." },
    ],
    done: "A published link, or a PDF, in the client's hands. Mark the project Sent on the Projects page.",
    tip: "Do Settings once before your first proposal — letterhead, license, who we are.",
  },

  "cost-database": {
    key: "cost-database",
    title: "Cost Database",
    purpose: "What things have cost you: unit prices from past jobs, $/SF by project type, and signed-contract anchors. The AI prices from here.",
    steps: [
      { do: "Open “Price history” — every confirmed price from every project, by line.", note: "" },
      { do: "Click “Build catalog” under “Cost items” to turn that history into unit prices; edit any you know by heart.", note: "“Rebuild from history” after a few more jobs." },
      { do: "Under “$/SF benchmarks”, type the sell price per square foot you've seen by project type, then “Save benchmarks”.", note: "The Estimate page compares every job to these." },
    ],
    done: "A catalog of unit prices you trust and a $/SF range per project type.",
  },

  settings: {
    key: "settings",
    title: "Settings",
    purpose: "Who you are on the proposal, and the markups every new estimate starts from.",
    steps: [
      { do: "Fill the company identity: name, license / bonding note, “Who we are”, “Next steps”, “Closing line”.", note: "Prints on every proposal." },
      { do: "Set the default markups (contingency, insurance, overhead & profit).", note: "Change them per project on the Estimate page." },
      { do: "Under “Branding”, upload your logo, pick your brand colour and default theme, add a slogan, choose the voice your proposals should sound like, and tick the kinds of jobs you take. “Save branding”.", note: "The colour becomes the app's buttons and links; the logo and slogan go on every proposal's letterhead and the client's link." },
      { do: "Under “Insurance statements”, choose how you carry general liability and workers' comp and type the carrier and phone.", note: "California requires these sentences on a home improvement contract; your answers pick the right one." },
      { do: "Pick light or dark under “Appearance”.", note: "" },
    ],
    done: "A proposal that reads like it came from your company, not from software.",
  },
};

/**
 * Which guide entry a route belongs to. Takes the pathname; returns the key,
 * plus the project id when inside one (so the panel can link to real pages).
 */
export function guideFor(pathname: string): { key: GuideKey; projectId: string | null } {
  const m = pathname.match(/^\/projects\/([0-9a-f-]{36})(?:\/([a-z-]+))?/i);
  if (m) {
    const projectId = m[1];
    const seg = m[2] ?? "";
    if (seg === "plans") return { key: "takeoff", projectId };
    if (seg === "scope" || seg === "pricing" || seg === "estimate" || seg === "proposal")
      return { key: seg, projectId };
    return { key: "project", projectId };
  }
  if (pathname.startsWith("/projects/new")) return { key: "new", projectId: null };
  if (pathname.startsWith("/cost-database")) return { key: "cost-database", projectId: null };
  if (pathname.startsWith("/settings")) return { key: "settings", projectId: null };
  return { key: "projects", projectId: null };
}

/** The page a guide key lives on, for a given project (null when it has no page yet). */
export function guideHref(key: GuideKey, projectId: string | null): string | null {
  switch (key) {
    case "projects":
      return "/projects";
    case "new":
      return "/projects/new";
    case "cost-database":
      return "/cost-database";
    case "settings":
      return "/settings";
    case "project":
      return projectId ? `/projects/${projectId}` : null;
    case "takeoff":
      // The viewer needs a plan id; the hub page knows it. Send people there.
      return projectId ? `/projects/${projectId}` : null;
    default:
      return projectId ? `/projects/${projectId}/${key}` : null;
  }
}
