/**
 * Canonical TiB topic → session routing catalog.
 * Used at query time (router) and ingest time (metadata.rag_topics).
 */

export type RagTopicDef = {
  id: string;
  label: string;
  /** Match user question (any hit adds score). */
  queryPatterns: RegExp[];
  /** Match source_title / session_display_title / metadata.rag_topics. */
  titlePatterns: RegExp[];
  /** Literal ILIKE terms when route fires but vector pool missed the session. */
  titleSearchTerms?: string[];
  /** Match metadata.source_file (JSON filename). */
  sourceFilePatterns?: RegExp[];
  /** Penalize these titles in session scoring when this topic is active. */
  blockTitlePatterns?: RegExp[];
  /** Preferred session for force-keys / primary when multiple titles match this topic. */
  primaryTitlePatterns?: RegExp[];
  weight?: number;
  /** Deterministic retrieval hints when this topic matches the query. */
  heuristicSearchQueries?: string[];
  heuristicTopicPhrases?: string[];
  heuristicSpeakerHints?: string[];
  /** Session score boost for matching titles (default 0.42). */
  sessionBoost?: number;
  /** Session score penalty for blockTitlePatterns (default 0.55). */
  blockPenalty?: number;
  /** Show only one KB link when primary matches this topic. */
  singleCitationWhenPrimary?: boolean;
};

export const RAG_TOPIC_CATALOG: RagTopicDef[] = [
  {
    id: 'daily_focus',
    label: 'Finding Daily Focus',
    weight: 1.2,
    queryPatterns: [
      /\bdaily focus\b/i,
      /\bfocus routine\b/i,
      /\bfocus journal\b/i,
      /\bdaily action list\b/i,
      /\beat that frog\b/i,
      /\bfocus slips?\b/i,
      /\bhorrible week\b/i,
      /\bthree weeks\b.*\b(routine|habit|focus)\b/i,
      /\b(routine|habit|focus)\b.*\bthree weeks\b/i,
      /\bcompletely stops?\b/i,
      /\bcome back tomorrow\b/i,
      /\bwho cares\b.*\bhad a go\b/i,
    ],
    titlePatterns: [/finding daily focus/i],
    titleSearchTerms: ['Finding Daily Focus'],
    sourceFilePatterns: [/finding daily focus/i],
    blockTitlePatterns: [
      /clea jones/i,
      /content marketing rockstar/i,
      /mental roadblocks/i,
    ],
  },
  {
    id: 'cashflow_slow_months',
    label: 'Cash flow slow months',
    weight: 1.18,
    queryPatterns: [
      /\bslow months?\b/i,
      /\bquiet period\b/i,
      /\bcash gap\b/i,
      /\btough months?\b/i,
      /\bseasonal\b.*\bcash\b/i,
      /\bcash flow\b.*\b(slow|quiet|tough|season)\b/i,
      /\b(improve|help).*\bcash flow\b/i,
    ],
    titlePatterns: [
      /cashflow forecast/i,
      /reduce cash flow stress/i,
      /quick cash flow/i,
      /cash flow for tradies/i,
    ],
    primaryTitlePatterns: [
      /how to: cashflow forecast/i,
      /how to cashflow forecast/i,
      /reduce cash flow stress/i,
      /quick cash flow strategies/i,
    ],
    blockTitlePatterns: [
      /financial jam with jackson/i,
      /griffiths/i,
      /marketing to survive/i,
    ],
    heuristicTopicPhrases: [
      'cash flow forecast',
      'slow months',
      'cash gap',
      'reduce cash flow stress',
    ],
    heuristicSearchQueries: ['cashflow forecast slow months tradie'],
  },
  {
    id: 'cash_bank_balance',
    label: 'Cash vs bank balance',
    weight: 1.15,
    queryPatterns: [
      /\bbank balance\b/i,
      /\bmoney in the account\b/i,
      /\bpositive bank\b/i,
      /\bcash flow is fine\b/i,
      /\balways have money\b/i,
      /\bhealthy cash flow management\b/i,
      /\bnot the same as\b/i,
    ],
    titlePatterns: [/wtf is cash vs accrual/i, /\bcash vs accrual\b/i],
    titleSearchTerms: ['WTF is Cash vs Accrual', 'Cash vs Accrual'],
    blockTitlePatterns: [/profit first/i, /get ready for eofy/i],
  },
  {
    id: 'fy_hopeful',
    label: 'FY hopeful (Two Drunk Accountants)',
    weight: 1.1,
    queryPatterns: [
      /\bmost hopeful\b/i,
      /\bnew financial year\b/i,
      /\bfirst day of a new financial year\b/i,
      /\boptimistic\b.*\b(july|financial year)\b/i,
      /\b(july|financial year)\b.*\b(optimistic|hopeful|struggle)\b/i,
    ],
    titlePatterns: [/two drunk accountants/i, /financial jam with two drunk/i],
    primaryTitlePatterns: [/two drunk accountants/i, /financial jam with two drunk/i],
    blockTitlePatterns: [/get ready for eofy/i, /momentum meet.*july/i],
    heuristicTopicPhrases: ['most hopeful time of the year', 'most hopeful time'],
    heuristicSearchQueries: [
      'Financial Jam with Two Drunk Accountants July new financial year',
      'Financial Jam with Two Drunk Accountants',
    ],
    blockPenalty: 0.5,
  },
  {
    id: 'marketing_rhys',
    label: 'Rhys / Kaha Digital marketing',
    queryPatterns: [
      /\bwebsite\b.*\b(visit|traffic|ring|call)\b/i,
      /\b(visit|traffic|ring|call)\b.*\bwebsite\b/i,
      /\bphone never rings\b/i,
      /\bkaha digital\b/i,
    ],
    titlePatterns: [/rhys/i, /kaha digital/i],
    primaryTitlePatterns: [/rhys/i, /kaha digital/i],
    blockTitlePatterns: [/cash flow for tradies with katie/i, /leads tracking/i],
    heuristicSpeakerHints: ['Rhys'],
    heuristicSearchQueries: [
      'Rhys Kaha Digital website traffic phone calls marketing audit',
    ],
    heuristicTopicPhrases: ['website traffic', 'phone never rings'],
  },
  {
    id: 'systems_where_to_start',
    label: 'Which systems to set up first',
    weight: 1.28,
    queryPatterns: [
      /\bwhat systems\b.*\b(first|start)\b/i,
      /\bwhich systems\b.*\b(first|start)\b/i,
      /\bsystems\b.*\b(set up|setup)\b.*\bfirst\b/i,
      /\b(set up|setup)\b.*\bsystems\b.*\bfirst\b/i,
      /\bwhere\b.*\bstart\b.*\bsystems\b/i,
      /\bsystems\b.*\bwhere to start\b/i,
      /\bfirst systems\b/i,
      /\bsystemi[sz]e\b.*\bwhere to start\b/i,
    ],
    titlePatterns: [
      /systemology expert/i,
      /tradie systems map/i,
      /7 myths of systemising/i,
      /systemising your business/i,
    ],
    primaryTitlePatterns: [
      /systemology expert/i,
      /tradie systems map/i,
      /7 myths of systemising/i,
    ],
    sourceFilePatterns: [
      /systemology expert session\.json/i,
      /tradie systems map/i,
      /7 myths of systemising/i,
    ],
    titleSearchTerms: [
      'Systemology Expert Session',
      'Tradie Systems Map',
      '7 Myths of Systemising',
    ],
    blockTitlePatterns: [
      /mindmeister/i,
      /systems mapping using mindmeister/i,
      /profit first for tradiepreneurs/i,
      /using ai in your trade/i,
      /trade-o with renee/i,
    ],
    heuristicTopicPhrases: [
      'where to start systems',
      'first systems tradie',
      'systemology',
    ],
    sessionBoost: 0.48,
    blockPenalty: 0.62,
  },
  {
    id: 'job_pricing_margin',
    label: 'Job pricing and margins',
    weight: 1.26,
    queryPatterns: [
      /\blosing money\b/i,
      /\blosing on (?:jobs|projects)\b/i,
      /\bnot making money\b/i,
      /\bfix pricing\b/i,
      /\b(?:how|what).*\b(?:pricing|prices)\b/i,
      /\bpricing\b.*\b(?:fix|wrong|low|raise|charge)\b/i,
      /\bjob\b.*\b(?:margin|profit|losing)\b/i,
      /\b(?:margin|margins)\b.*\b(?:low|thin|wrong|improve)\b/i,
      /\bundercharg/i,
      /\bbackcost/i,
      /\bhourly rate\b/i,
      /\bcharge enough\b/i,
      /\bhelp\b.*\b(?:pricing|losing|margin|projects)\b/i,
      /\b(?:pricing|losing|margin)\b.*\b(?:help|fix)\b/i,
    ],
    titlePatterns: [
      /backcosting/i,
      /hourly rate calculator/i,
      /five profit levers/i,
      /price objection/i,
      /tradiepreneur financial dashboard/i,
    ],
    primaryTitlePatterns: [
      /done with you session on backcosting/i,
      /hourly rate calculator/i,
      /five profit levers/i,
    ],
    sourceFilePatterns: [
      /backcosting\.json/i,
      /hourly_rate_calculator/i,
      /five profit levers/i,
    ],
    titleSearchTerms: [
      'Done With You Session on Backcosting',
      'Hourly Rate Calculator',
      'Five Profit Levers',
    ],
    blockTitlePatterns: [
      /using ai in your trade/i,
      /financial jam with jackson/i,
      /\bfinancial jam\b/i,
      /marketing to survive/i,
      /mindmeister/i,
      /trade[- ]?o with renee/i,
    ],
    heuristicTopicPhrases: [
      'losing money on projects',
      'fix pricing tradie',
      'job margin backcosting',
      'hourly rate calculator',
    ],
    heuristicSearchQueries: [
      'backcosting job margin losing money tradie pricing hourly rate',
    ],
    sessionBoost: 0.46,
    blockPenalty: 0.6,
  },
  {
    id: 'systemology',
    label: 'Systemology Expert Session',
    queryPatterns: [
      /\bsystemology\b/i,
      /\bapprentice\b.*\b(checklist|systems)\b/i,
      /\b(checklist|systems)\b.*\bapprentice\b/i,
      /\bdocumenting systems\b/i,
    ],
    titlePatterns: [/systemology expert/i],
    primaryTitlePatterns: [/systemology expert/i],
    blockTitlePatterns: [/tradie systems map checklist/i, /mindmeister/i],
    sessionBoost: 0.42,
    heuristicSearchQueries: [
      'Systemology Expert Session documenting systems apprentice checklist',
    ],
    heuristicTopicPhrases: ['documenting systems', 'systemology'],
  },
  {
    id: 'charge_quotes',
    label: 'Charge for quotes',
    queryPatterns: [/\bcharge for quotes\b/i, /\bqualifying bad clients\b/i],
    titlePatterns: [/should you charge for quotes/i],
  },
  {
    id: 'cash_accrual',
    label: 'Cash vs accrual',
    queryPatterns: [/\bcash vs accrual\b/i, /\baccrual\b/i],
    titlePatterns: [/wtf is cash vs accrual/i],
  },
  {
    id: 'hire_apprentice',
    label: 'Hire apprentice',
    weight: 1.22,
    queryPatterns: [
      /\bhire\b.*\bapprentice\b/i,
      /\bapprentice\b.*\b(screening|hire)\b/i,
      /\bfirst apprentice\b/i,
      /\bjob ad\b/i,
      /\bwrite\b.*\b(job )?ad\b/i,
      /\bapprentice\b.*\bad\b/i,
      /\brecruit\b.*\bapprentice\b/i,
    ],
    titlePatterns: [
      /hr for tradies/i,
      /sexy job ad/i,
      /hiring cheat/i,
    ],
    primaryTitlePatterns: [
      /hr for tradies/i,
      /expert sessions done with you screening/i,
      /hiring cheat/i,
      /write your sexy job ad/i,
    ],
    titleSearchTerms: [
      'HR for Tradies',
      'Expert Sessions Done with You Screening',
      'Hiring Cheat Sheet',
      'Write Your Sexy Job Ad',
    ],
    blockTitlePatterns: [
      /expert sessions done with you screening/i,
      /position description guide/i,
      /setting boundaries with apprentice/i,
    ],
    heuristicSearchQueries: [
      'HR for Tradies hire first apprentice screening questions',
    ],
    heuristicTopicPhrases: ['first apprentice', 'screening questions'],
  },
  {
    id: 'momentum_kitchen_warranty',
    label: 'Momentum kitchen warranty',
    queryPatterns: [
      /\bkitchen\b.*\bwarranty\b/i,
      /\bwarranty\b.*\bkitchen\b/i,
      /\bout of warranty\b/i,
    ],
    titlePatterns: [/1133307969/i, /collins group/i, /\bkfc\b/i],
    blockTitlePatterns: [/momentum meet april 29/i],
    heuristicSearchQueries: [
      'Momentum Meet kitchen job warranty client say no fight',
    ],
    heuristicTopicPhrases: ['out of warranty', 'kitchen job', '12 months'],
  },
  {
    id: 'momentum_say_no',
    label: 'Say no to fit outs',
    queryPatterns: [
      /\binternal fit outs?\b/i,
      /\bsay no\b.*\bfit\b/i,
      /\bcrappy jobs\b/i,
      /\bpaid quotes\b/i,
    ],
    titlePatterns: [
      /how to say no to crappy jobs/i,
      /7 may 2025/i,
      /\bsay no\b/i,
    ],
    blockTitlePatterns: [/momentum meet april 29/i],
    heuristicSearchQueries: [
      'Momentum Meet say no internal fit outs paid quotes May 2025',
      'How To Say No To Crappy Jobs internal fit outs',
    ],
    heuristicTopicPhrases: ['internal fit out', 'paid quotes', 'say no', 'crappy jobs'],
  },
  {
    id: 'eofy_webinar',
    label: 'EOFY webinar',
    queryPatterns: [/\beofy\b/i, /\bend of financial year\b/i, /\bget ready for eofy\b/i],
    titlePatterns: [/get ready for eofy/i, /eofy webinar/i],
    blockTitlePatterns: [/two drunk accountants/i],
  },
  {
    id: 'drunk_accountants',
    label: 'Two Drunk Accountants',
    queryPatterns: [
      /\btwo drunk accountants\b/i,
      /\bfinancial jam\b/i,
      /\bdrunk accountants\b/i,
    ],
    titlePatterns: [/two drunk accountants/i, /financial jam with two drunk/i],
  },
  {
    id: 'profit_first',
    label: 'Profit First',
    queryPatterns: [/\bprofit first\b/i],
    titlePatterns: [/profit first/i],
  },
  {
    id: 'nicole_tasks',
    label: 'Nicole Davidson tasks',
    queryPatterns: [/\bnicole\b/i, /\bthree (physical )?tasks\b/i],
    titlePatterns: [/nicole davidson/i],
  },
  {
    id: 'offshore_va_delegation',
    label: 'Offshore VA delegation (Momentum Meet March 4)',
    weight: 1.36,
    queryPatterns: [
      /\boffshore\b.*\b(va|virtual assistant)/i,
      /\bvirtual assistant/i,
      /\boffshore va\b/i,
      /\benglish\b.*\bsecond language\b/i,
      /\bsecond language\b/i,
      /\bdelegat\w*\b.*\b(offshore|virtual assistant|va)\b/i,
      /\b(offshore|virtual assistant|va)\b.*\bdelegat/i,
      /\bliteral\b.*\bdirection\b/i,
    ],
    titlePatterns: [/momentum meet march 4/i],
    primaryTitlePatterns: [/momentum meet march 4/i],
    sourceFilePatterns: [/momentum_meet_march_4/i],
    titleSearchTerms: ['Momentum Meet March 4', 'offshore VA delegation'],
    blockTitlePatterns: [
      /get off the tools/i,
      /expert session with dani ferrier/i,
      /expert webinar with joe pane/i,
    ],
    heuristicTopicPhrases: [
      'offshore VA',
      'English is a second language',
      'quite literal with how we give direction',
      'Clear delegation to a VA is extremely important when they are offshore',
      'miss a lot of the nuances',
    ],
    heuristicSearchQueries: [
      'offshore VA clear delegation English second language literal direction',
      'Momentum Meet March 4 offshore virtual assistant',
    ],
    sessionBoost: 0.5,
    blockPenalty: 0.6,
  },
  {
    id: 'dani_ferrier_delegation',
    label: 'Dani Ferrier delegation & Critical Alignment Model',
    weight: 1.32,
    queryPatterns: [
      /\bcritical alignment model\b/i,
      /\bcritical alignment\b/i,
      /\bdani ferrier\b/i,
      /\bdanny ferer\b/i,
      /\bdelegat\w*\b.*\b(critical alignment|alignment model|concerns?|expectations)\b/i,
      /\b(critical alignment|alignment model)\b.*\bdelegat\w*/i,
      /\bconcerns?\b.*\bleaders?\b.*\bdelegat/i,
      /\bmeaningful connections\b.*\bclients?\b/i,
      /\bletting go\b.*\bkey clients?\b/i,
    ],
    titlePatterns: [/expert session with dani ferrier/i, /dani ferrier/i],
    primaryTitlePatterns: [/expert session with dani ferrier/i],
    sourceFilePatterns: [/expert session with dani ferrier\.json/i],
    titleSearchTerms: ['Expert Session with Dani Ferrier', 'Dani Ferrier'],
    blockTitlePatterns: [
      /get off the tools/i,
      /expert session with kristy/i,
      /how to work with your partner/i,
      /momentum meet/i,
    ],
    heuristicTopicPhrases: [
      'critical alignment model',
      'delegation skills',
      'meaningful connections clients',
    ],
    heuristicSearchQueries: [
      'Dani Ferrier delegation critical alignment model leaders concerns',
    ],
    sessionBoost: 0.48,
    blockPenalty: 0.58,
  },
  {
    id: 'joe_delegation',
    label: 'Joe Pane / Get Off the Tools',
    weight: 1.2,
    queryPatterns: [
      /\bget off the tools\b/i,
      /\bdelegat/i,
      /\bstuck on the tools\b/i,
      /\bstep back\b.*\b(business|tools)\b/i,
      /\bstill on the tools\b/i,
    ],
    titlePatterns: [/get off the tools/i],
    primaryTitlePatterns: [/get off the tools/i],
    titleSearchTerms: ['Get Off the Tools'],
    blockTitlePatterns: [/expert webinar with joe pane/i],
    sessionBoost: 0.44,
  },
  {
    id: 'joe_pane_improv',
    label: 'Joe Pane improv webinar',
    weight: 1.25,
    queryPatterns: [
      /\bimprov\b/i,
      /\bimprov[- ]style\b/i,
      /\btransformational\b.*\bimprov/i,
      /\bslide deck\b/i,
      /\bjoe pane\b/i,
      /\bexpert webinar with joe\b/i,
      /\bhow tradies\b.*\b(behaviou?r|change|learn)\b/i,
    ],
    titlePatterns: [/expert webinar with joe pane/i, /influence and profit accelerator with joe pane/i],
    primaryTitlePatterns: [/expert webinar with joe pane/i],
    sourceFilePatterns: [/expert webinar with joe pane/i],
    titleSearchTerms: ['Expert Webinar with Joe Pane', 'Joe Pane'],
    blockTitlePatterns: [
      /josie askin/i,
      /getting the most out of the tradiepreneur/i,
      /expert sessions done with you screening/i,
      /dale stephens/i,
      /sophiie ai/i,
    ],
    heuristicSpeakerHints: ['Joe Pane'],
    heuristicSearchQueries: [
      'Expert Webinar with Joe Pane transformational improv tradies',
      'Joe Pane improv personal development slide deck',
    ],
    heuristicTopicPhrases: [
      'transformational improv',
      'improv show',
      'personal development and growth',
    ],
    sessionBoost: 0.45,
    blockPenalty: 0.58,
  },
  {
    id: 'masogi',
    label: 'Masogi Friday',
    weight: 1.2,
    queryPatterns: [/\bmasogi\b/i, /\bfriday session\b/i],
    titlePatterns: [/masogi/i, /legacy archive/i, /momentum.*jan/i],
    primaryTitlePatterns: [/masogi/i, /legacy archive/i, /momentum.*jan/i],
    blockTitlePatterns: [
      /griffiths/i,
      /referral based marketing/i,
      /michael griffiths expert/i,
    ],
    heuristicTopicPhrases: ['masogi', 'legacy archive'],
  },
  {
    id: 'griffiths_referrals',
    label: 'Michael Griffiths referrals',
    queryPatterns: [/\bgriffiths\b/i, /\breferral/i],
    titlePatterns: [/michael griffiths/i],
  },
  {
    id: 'nic_waz_meeting',
    label: 'Nic & Waz meeting structure',
    weight: 1.28,
    queryPatterns: [
      /\bweekly leadership meeting\b/i,
      /\bmeeting rhythm\b/i,
      /\bagenda habits\b/i,
      /\bowned to a deadline\b/i,
      /\bnothing is owned\b/i,
      /\bsame three issues\b/i,
      /\bissues reappear\b/i,
      /\bnic.*waz\b/i,
      /\bmeeting structure\b/i,
      /\b(weekly|fortnightly) (team|leadership) meeting\b/i,
      /\bpeople management system\b/i,
      /\bscorecard review\b/i,
    ],
    titlePatterns: [
      /nic.*waz.*meeting structure/i,
      /meeting structure.*nic/i,
    ],
    primaryTitlePatterns: [/nic.*waz.*meeting structure/i],
    sourceFilePatterns: [/nic.*waz.*meeting structure/i],
    titleSearchTerms: [
      'Done With You Session with Nic & Waz on Meeting Structure',
      'Nic & Waz on Meeting Structure',
    ],
    blockTitlePatterns: [
      /leadership skills/i,
      /expert sessin with mick/i,
      /how to be a leader - even when/i,
      /momentum meet/i,
      /getting the most out of the tradiepreneur/i,
    ],
    heuristicSearchQueries: [
      'Done With You Session Nic Waz meeting structure weekly team meeting agenda',
      'weekly one-on-one scorecard review team meeting tradiepreneur',
    ],
    heuristicTopicPhrases: [
      'people management system',
      'weekly team meeting',
      '15 keys for team meetings',
    ],
    sessionBoost: 0.48,
    blockPenalty: 0.55,
    singleCitationWhenPrimary: true,
  },
  {
    id: 'content_storytelling',
    label: 'Content / storytelling (Sam Winch)',
    weight: 1.2,
    queryPatterns: [
      /\bcontent ideas?\b/i,
      /\bjob[- ]site stor/i,
      /\bnothing published\b/i,
      /\bmarketing guru\b/i,
      /\bstorytelling\b/i,
      /\bturn\b.*\binto content\b/i,
      /\bmessy\b.*\b(experience|trade)\b/i,
      /\b(experience|trade)\b.*\bcontent\b/i,
      /\bcontent marketing rockstar\b/i,
      /\bsam winch\b/i,
      /\bauthentic content\b/i,
    ],
    titlePatterns: [
      /turning your ideas into content/i,
      /sam winch/i,
      /clea jones.*content marketing/i,
      /clea jones.*mental roadblocks/i,
      /social media scheduling/i,
    ],
    primaryTitlePatterns: [
      /turning your ideas into content/i,
      /sam winch/i,
    ],
    sourceFilePatterns: [
      /turning your ideas into content/i,
      /sam winch/i,
      /clea jones.*mental roadblocks/i,
      /social media scheduling/i,
    ],
    titleSearchTerms: [
      'Turning Your Ideas Into Content',
      'Sam Winch',
      'Content Marketing Rockstar',
    ],
    blockTitlePatterns: [
      /trade[- ]?o/i,
      /renee boardman/i,
      /\btradeo\b/i,
      /hiring cheat/i,
      /write your sexy job ad/i,
    ],
    heuristicSearchQueries: [
      'Turning Your Ideas Into Content Sam Winch job site stories',
      'authentic content creation tradies social media',
    ],
    heuristicTopicPhrases: [
      'turn ideas into content',
      'job site stories',
      'marketing guru',
      'Sam Winch',
    ],
    sessionBoost: 0.4,
    blockPenalty: 0.62,
  },
  {
    id: 'pdf_debtor_management',
    label: 'Debtor management process (PDF)',
    weight: 1.28,
    queryPatterns: [
      /\b45.?90\s*days\b/i,
      /\bdebtors?\b/i,
      /\boverdue invoices?\b/i,
      /\bad[\s-]?hoc chasing\b/i,
      /\binvoices? are.*late\b/i,
      /\bweekly.*chasing\b/i,
    ],
    titlePatterns: [/debtor management/i],
    sourceFilePatterns: [/debtor-management/i],
    primaryTitlePatterns: [/debtor management/i],
    blockTitlePatterns: [
      /cash flow for tradies/i,
      /cf challenge/i,
      /katie crismale/i,
      /quick cash flow/i,
      /managing debtors/i,
    ],
    heuristicSearchQueries: ['Debtor Management Process weekly chasing tradie'],
  },
  {
    id: 'pdf_price_objection',
    label: 'Price objection script (PDF)',
    weight: 1.25,
    queryPatterns: [
      /\btoo expensive\b/i,
      /\bcheaper quote\b/i,
      /\bwithout discounting\b/i,
      /\bprice objection\b/i,
      /\btalking myself out of the job\b/i,
    ],
    titlePatterns: [/price objection/i],
    sourceFilePatterns: [/price-objection/i],
    primaryTitlePatterns: [/price objection/i],
    blockTitlePatterns: [/hazardco/i, /should you charge for quotes/i],
    heuristicSearchQueries: ['Price Objection Handling Script tradie'],
  },
  {
    id: 'pdf_screen_customers',
    label: 'Screen customers (PDF)',
    weight: 1.22,
    queryPatterns: [
      /\bbooked out\b/i,
      /\bbad[\s-]?fit clients?\b/i,
      /\bbefore committing\b/i,
      /\bsite visit\b/i,
      /\bsaying yes to everyone\b/i,
    ],
    titlePatterns: [/screen customers/i, /10 questions.*screen/i],
    sourceFilePatterns: [/screen-customers/i],
    primaryTitlePatterns: [/screen customers/i, /10 questions/i],
    blockTitlePatterns: [
      /a,b, c and d clients/i,
      /identifying your a/i,
      /screening questions/i,
    ],
    heuristicSearchQueries: ['10 Questions Screen Customers tradie'],
  },
  {
    id: 'pdf_hiring_cheat',
    label: 'Hiring cheat sheet (PDF)',
    weight: 1.24,
    queryPatterns: [
      /\bsecond tradie\b/i,
      /\bnever hired properly\b/i,
      /\bhiring cheat\b/i,
      /\bwrong person\b/i,
      /\bsix weeks\b.*\bhire\b/i,
    ],
    titlePatterns: [/hiring cheat/i],
    sourceFilePatterns: [/hiring-cheat/i],
    primaryTitlePatterns: [/hiring cheat/i],
    blockTitlePatterns: [
      /hr for tradies/i,
      /cash flow for tradies/i,
      /write your sexy job ad/i,
      /screening questions/i,
    ],
    heuristicSearchQueries: ['Hiring Cheat Sheet tradie recruitment'],
  },
  {
    id: 'pdf_kpis_implement',
    label: 'KPIs implementation (PDF)',
    weight: 1.2,
    queryPatterns: [
      /\bkpis?\b/i,
      /\btrack revenue in xero\b/i,
      /\bactually improving\b/i,
      /\bdrowning in spreadsheets\b/i,
      /\bpick a few kpis\b/i,
    ],
    titlePatterns: [/kpis how to implement/i, /kpis.*implement/i],
    sourceFilePatterns: [/kpis-how-to-implement/i],
    primaryTitlePatterns: [/kpis how to implement/i],
    blockTitlePatterns: [/cf challenge/i, /^cf challenge/i],
    heuristicSearchQueries: ['KPIs How To Implement tradie business'],
  },
  {
    id: 'client_avatar_dwy',
    label: 'Client avatar (right now vs ideal)',
    weight: 1.1,
    queryPatterns: [
      /\bright[\s-]?now avatar\b/i,
      /\bideal avatar\b/i,
      /\bdream client\b/i,
      /\bcan't actually win yet\b/i,
      /\bcalendar gaps\b/i,
    ],
    titlePatterns: [/^client avatar$/i, /\bclient avatar\b/i],
    sourceFilePatterns: [/client avatar\.json/i],
    primaryTitlePatterns: [/client avatar/i],
  },
  {
    id: 'tradiepreneur_program',
    label: 'Getting the most out of Tradiepreneur program',
    weight: 1.1,
    queryPatterns: [
      /\bprogram months\b/i,
      /\bonly use coaching when\b/i,
      /\bin crisis\b/i,
      /\bvalue from membership\b/i,
      /\btradiepreneur program\b/i,
    ],
    titlePatterns: [/getting the most out of the tradiepreneur/i],
    sourceFilePatterns: [/getting the most out of the tradiepreneur/i],
    primaryTitlePatterns: [/getting the most out of the tradiepreneur/i],
    blockTitlePatterns: [/josie askin/i, /tradiepreneur program.*behaviou/i],
  },
  {
    id: 'buildxact_demo',
    label: 'Buildxact demo session',
    weight: 1.22,
    queryPatterns: [
      /\bbuildxact\b/i,
      /\bbuild xact\b/i,
      /\bbuildex act\b/i,
      /\boutgrowing spreadsheets\b/i,
      /\bquoting and job tracking\b/i,
    ],
    titlePatterns: [/demo and q&a expert/i, /buildxact/i, /buildex/i],
    sourceFilePatterns: [/demo and q&a expert session/i],
    primaryTitlePatterns: [/demo and q&a expert/i],
    blockTitlePatterns: [/tradie systems map/i, /mindmeister/i],
    heuristicSearchQueries: ['Buildxact demo quoting job tracking'],
  },
  {
    id: 'hr_system_dwy',
    label: 'HR System For Success (DWY)',
    weight: 1.26,
    queryPatterns: [
      /\bhr system\b/i,
      /\bwarnings, performance\b/i,
      /\bperformance, and paperwork\b/i,
      /\bpaperwork are messy\b/i,
      /\blegal mess\b/i,
      /\bstaff issues eat\b/i,
    ],
    titlePatterns: [/hr system for success/i],
    sourceFilePatterns: [/hr system for success/i],
    primaryTitlePatterns: [/hr system for success/i],
    blockTitlePatterns: [
      /sam winch/i,
      /turning your ideas into content/i,
      /hr for tradies.*hire/i,
    ],
    heuristicSearchQueries: ['HR System For Success tradie warnings performance'],
  },
  {
    id: 'marketing_plan_budget_dwy',
    label: 'Right-now marketing plan & leads budget',
    weight: 1.24,
    queryPatterns: [
      /\bright[\s-]?now marketing plan\b/i,
      /\bleads budget\b/i,
      /\bspending on ads\b/i,
      /\bcan't tell what's working\b/i,
      /\bcan't tell what.s working\b/i,
      /\bguessing each month\b/i,
    ],
    titlePatterns: [/right now.*marketing plan/i, /leads budget/i],
    sourceFilePatterns: [/marketing plan.*leads budget/i],
    primaryTitlePatterns: [/marketing plan.*leads budget/i],
    blockTitlePatterns: [
      /cf challenge/i,
      /marketing to survive tough times/i,
      /rhys|kaha digital/i,
    ],
    heuristicSearchQueries: [
      'right now marketing plan leads budget tradie',
    ],
  },
  {
    id: 'cf_challenge_program',
    label: 'CF Challenge / Trade Desk',
    weight: 1.2,
    queryPatterns: [
      /\bfour[\s-]?week\b/i,
      /\bcash flow challenge\b/i,
      /\btrade desk\b/i,
      /\bavoiding the numbers\b/i,
      /\bscary.*numbers\b/i,
      /\bcash flow feels scary\b/i,
    ],
    titlePatterns: [/^cf challenge/i, /\bcf challenge 1\b/i],
    sourceFilePatterns: [/cf challenge 1\.json/i, /cf challenge/i],
    primaryTitlePatterns: [/cf challenge/i],
    blockTitlePatterns: [
      /using ai in your trade/i,
      /cashflow forecast/i,
      /how to: cashflow/i,
    ],
    heuristicSearchQueries: ['CF Challenge Trade Desk four week cash flow'],
  },
  {
    id: 'hazardco_safety',
    label: 'HazardCo site safety',
    weight: 1.2,
    queryPatterns: [
      /\bhazardco\b/i,
      /\bswms\b/i,
      /\bsafety paperwork\b/i,
      /\bkeeping safety simple\b/i,
      /\bresidential jobs\b/i,
    ],
    titlePatterns: [/hazardco/i, /talking safety/i],
    sourceFilePatterns: [/hazardco/i],
    primaryTitlePatterns: [/hazardco/i],
  },
  {
    id: 'momentum_aug27_2025',
    label: 'Momentum Meet 27 August 2025',
    weight: 1.22,
    queryPatterns: [
      /\bthree[\s-]?month job\b/i,
      /\bmindset.*caught up\b/i,
      /\bself[\s-]?doubt\b/i,
      /\btalked himself out\b/i,
      /\bopportunities? outgrow\b/i,
      /\bhadn't caught up with the business\b/i,
    ],
    titlePatterns: [/momentum meet 27 august 2025/i],
    sourceFilePatterns: [/momentum_meet_27_august/i],
    primaryTitlePatterns: [/27 august 2025/i],
    blockTitlePatterns: [
      /michael griffiths/i,
      /referral based marketing/i,
      /momentum meet 20 august/i,
    ],
  },
  {
    id: 'wealth_in_chaos',
    label: 'Creating Wealth In Chaos',
    weight: 1.22,
    queryPatterns: [
      /\bwealth[\s-]?building\b/i,
      /\bnothing sticks personally\b/i,
      /\buncertain times\b/i,
      /\bprofit in the business is okay\b/i,
      /\bwealth keeps getting pushed\b/i,
      /\bjackson milan\b/i,
    ],
    titlePatterns: [/creating wealth in chaos/i, /building wealth in uncertain/i],
    sourceFilePatterns: [/creating wealth in chaos/i],
    primaryTitlePatterns: [/creating wealth in chaos/i],
    blockTitlePatterns: [
      /financial jam with jackson/i,
      /financial jam with two drunk/i,
      /two drunk accountants/i,
    ],
    heuristicSpeakerHints: ['Jackson Milan'],
    heuristicSearchQueries: ['Creating Wealth In Chaos Jackson Milan tradie'],
  },
  {
    id: 'leads_tracking_dwy',
    label: 'Leads tracking & marketing Q&A',
    weight: 1.26,
    queryPatterns: [
      /\bleads conversion tracker\b/i,
      /\bdaily test[\s-]?and[\s-]?measure\b/i,
      /\btest[\s-]?and[\s-]?measure sheet\b/i,
      /\bchannel brings jobs\b/i,
      /\bmarketing spend is leaking\b/i,
      /\bleads tracking\b/i,
      /\bactually convert\b/i,
    ],
    titlePatterns: [/leads tracking.*marketing/i, /marketing q&a/i],
    sourceFilePatterns: [/leads tracking.*marketing/i],
    primaryTitlePatterns: [/leads tracking/i],
    blockTitlePatterns: [
      /marketing to survive tough times/i,
      /rhys|kaha digital/i,
      /done with you.*marketing & ai/i,
    ],
    heuristicSearchQueries: [
      'Leads Tracking Marketing Q&A test and measure conversion tracker',
    ],
  },
];

const JOE_DELEGATION_EXCLUSIONS =
  /\b(offshore|virtual assistant|second language|critical alignment|dani ferrier)\b/i;

export function scoreTopicsForQuery(userQuery: string): { id: string; score: number }[] {
  const q = userQuery.replace(/\s+/g, ' ').trim();
  const scores: { id: string; score: number }[] = [];

  for (const topic of RAG_TOPIC_CATALOG) {
    let score = 0;
    const w = topic.weight ?? 1;

    if (topic.id === 'joe_delegation' && JOE_DELEGATION_EXCLUSIONS.test(q)) {
      scores.push({ id: topic.id, score: 0 });
      continue;
    }

    for (const re of topic.queryPatterns) {
      if (re.test(q)) score += 0.22 * w;
    }

    scores.push({ id: topic.id, score });
  }

  return scores
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);
}

export function inferRagTopicsFromTitle(
  sessionTitle: string,
  sourceFile?: string | null
): string[] {
  const blob = `${sessionTitle} ${sourceFile ?? ''}`.toLowerCase();
  const out: string[] = [];

  for (const topic of RAG_TOPIC_CATALOG) {
    if (topic.titlePatterns.some((re) => re.test(blob))) {
      out.push(topic.id);
      continue;
    }
    if (
      topic.sourceFilePatterns?.some((re) =>
        re.test((sourceFile ?? '').toLowerCase())
      )
    ) {
      out.push(topic.id);
    }
  }

  return [...new Set(out)];
}

export function getTopicById(id: string): RagTopicDef | undefined {
  return RAG_TOPIC_CATALOG.find((t) => t.id === id);
}
