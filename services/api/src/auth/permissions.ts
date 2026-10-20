/**
 * The permission catalog and clinical credential rules (module 1).
 *
 * A role (standard or custom) is a set of permissions and decides which screens and patients a
 * user can reach. A credential decides which clinical acts they may perform. Both are checked on
 * the server for every request; the apps only hide what a role cannot use.
 *
 * The permission list must match sineobex.known_permissions() in db/migrations/0002; a test fails
 * if they drift.
 */

export const PERMISSIONS = {
  'team.manage_users': 'Invite and remove staff; change their roles and credentials',
  'team.manage_presets': 'Change note types, bundles, the item catalog, flags, mappings and alert rules',
  'team.view_audit': 'Search the audit log and see unusual-access flags',
  'patients.view': "See the team's patients and their charts",
  'patients.edit': 'Create patients and edit demographics',
  'patients.correct_identity': 'Correct a legal name or date of birth, with a reason',
  'patients.review_duplicates': 'Decide pairs in the duplicate merge queue',
  'patients.view_sensitive':
    'See behavioral health, harm reduction and reproductive details, including pregnancy',
  'patients.view_sensitive_exams': 'See GU, breast and rectal exam findings',
  'patients.reverse_resolved': 'Set a Resolved problem back to Ongoing, with a reason',
  'encounters.chart': 'Chart encounters',
  'checkins.create': 'Log quick check-ins',
  'referrals.create': 'Create referrals',
  'routes.view': 'See routes and runs',
  'routes.manage': 'Build and assign routes; send change requests',
  'inventory.view': 'See bags, team stock and supply logs',
  'inventory.manage': 'Restock bags, move stock and record recounts',
  'billing.view_codes': 'See ICD-10 and CPT codes and supply logs',
  'exports.billing': 'Run the billing export',
  'exports.grant': 'Run grant reports',
  'exports.data': 'Run the full customer data export',
  'quarantine.review': 'Review records sent from a removed user’s phone',
  'devices.manage': 'See devices and remotely wipe a lost phone',
} as const;

export type Permission = keyof typeof PERMISSIONS;
export const PERMISSION_KEYS = Object.keys(PERMISSIONS) as Permission[];

export function isPermission(value: string): value is Permission {
  return Object.hasOwn(PERMISSIONS, value);
}

/** Roles only owners may assign or take away (module 1: "A Program Admin can't appoint another Program Admin"). */
export const OWNER_ONLY_ROLE_KEYS = new Set(['program_admin']);

/** Community health worker preset, created as a custom role on every new team (module 1). */
export const CHW_PRESET = {
  key: 'community_health_worker',
  name: 'Community health worker',
  description: 'Demographics, check-ins and referrals. No clinical notes.',
  permissions: [
    'patients.view',
    'patients.edit',
    'checkins.create',
    'referrals.create',
    'routes.view',
  ] as Permission[],
};

export const CREDENTIALS = ['attending', 'resident', 'np', 'pa', 'student', 'chw', 'none'] as const;
export type Credential = (typeof CREDENTIALS)[number];

export interface CredentialCapabilities {
  /** May open Medical encounters and clinical templates. */
  chartMedical: boolean;
  /** May place medication orders (and run bundles that contain medications). */
  orderMedications: boolean;
  /** May sign notes. Students route to a co-signer instead. */
  sign: boolean;
  /** May attest residents' and NPs' notes. */
  attest: boolean;
  /** A signed note enters the billing export only after an attending attests (Oct 12). */
  billingNeedsAttestation: boolean;
  /** Ordering for the up/down rule: moving up needs the new credential's fields and a reason. */
  rank: number;
}

export const CAPABILITIES: Record<Credential, CredentialCapabilities> = {
  attending: {
    chartMedical: true,
    orderMedications: true,
    sign: true,
    attest: true,
    billingNeedsAttestation: false,
    rank: 4,
  },
  resident: {
    chartMedical: true,
    orderMedications: true,
    sign: true,
    attest: false,
    billingNeedsAttestation: true,
    rank: 3,
  },
  np: {
    chartMedical: true,
    orderMedications: true,
    sign: true,
    attest: false,
    billingNeedsAttestation: true,
    rank: 3,
  },
  // PLAN-OPEN: the PA rule is "to confirm". Treated like NP (held from billing until attested),
  // the conservative choice; change billingNeedsAttestation once the FQHC partner answers.
  pa: {
    chartMedical: true,
    orderMedications: true,
    sign: true,
    attest: false,
    billingNeedsAttestation: true,
    rank: 3,
  },
  student: {
    chartMedical: true,
    orderMedications: false,
    sign: false,
    attest: false,
    billingNeedsAttestation: true,
    rank: 2,
  },
  chw: {
    chartMedical: false,
    orderMedications: false,
    sign: false,
    attest: false,
    billingNeedsAttestation: false,
    rank: 1,
  },
  none: {
    chartMedical: false,
    orderMedications: false,
    sign: false,
    attest: false,
    billingNeedsAttestation: false,
    rank: 0,
  },
};

export type CredentialField =
  | 'school'
  | 'supervisingPhysician'
  | 'npi'
  | 'program'
  | 'supervisingAttending'
  | 'licenseNumber'
  | 'licenseState';

// PLAN-OPEN: proposed in the Oct 19 decisions, pending Brooke and Mercy.
export const REQUIRED_FIELDS: Record<Credential, CredentialField[]> = {
  student: ['school', 'supervisingPhysician'],
  resident: ['npi', 'program', 'supervisingAttending'],
  attending: ['npi', 'licenseNumber', 'licenseState'],
  np: ['npi', 'licenseNumber', 'licenseState'],
  pa: ['npi', 'licenseNumber', 'licenseState'],
  chw: [],
  none: [],
};

const US_STATES = new Set(
  'AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA PR RI SC SD TN TX UT VT VA VI WA WV WI WY GU AS MP'.split(
    ' ',
  ),
);

/**
 * NPI check digit (CMS): Luhn over the 9-digit base with the 80840 prefix. Catches most typos,
 * which matters because the billing export carries the NPI on every claim line.
 */
export function isValidNpi(npi: string): boolean {
  if (!/^[12]\d{9}$/.test(npi)) return false;
  const digits = `80840${npi.slice(0, 9)}`;
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 0) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  const check = (10 - (sum % 10)) % 10;
  return check === Number(npi[9]);
}

export interface FieldProblem {
  field: CredentialField;
  problem: 'missing' | 'invalid';
}

export function checkCredentialFields(
  credential: Credential,
  fields: Record<string, unknown>,
): FieldProblem[] {
  const problems: FieldProblem[] = [];
  for (const field of REQUIRED_FIELDS[credential]) {
    const raw = fields[field];
    const value = typeof raw === 'string' ? raw.trim() : '';
    if (!value) {
      problems.push({ field, problem: 'missing' });
      continue;
    }
    if (field === 'npi' && !isValidNpi(value)) problems.push({ field, problem: 'invalid' });
    if (field === 'licenseState' && !US_STATES.has(value.toUpperCase()))
      problems.push({ field, problem: 'invalid' });
  }
  return problems;
}

/** Moving up, or sideways to a different credential of the same rank, needs the new fields. */
export function isUpgrade(from: Credential, to: Credential): boolean {
  if (from === to) return false;
  return CAPABILITIES[to].rank >= CAPABILITIES[from].rank;
}
