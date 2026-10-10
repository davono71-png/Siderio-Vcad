export const RESERVED_MESSAGE = "Accesso riservato all'amministratore";

export type AdminProfile = {
  is_master?: boolean | null;
  ruolo?: string | null;
};

/**
 * Who may use Vcad. The default is `is_master` on `profili_utenti`.
 * `VCAD_ADMIN_RULE` can widen it later, comma-separated:
 * `is_master`, `ruolo:Manager`. An unknown token never grants access.
 * `Amministrazione` is the accounting department, not an administrator.
 */
export function adminRule() {
  const raw = process.env.VCAD_ADMIN_RULE;
  const rule = (raw === undefined ? "is_master" : raw).trim();
  return rule || "is_master";
}

export function isAdministrator(profile: AdminProfile | null | undefined) {
  if (!profile) return false;
  const tokens = adminRule()
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (tokens.length === 0) return false;
  return tokens.some((token) => matchesRule(token, profile));
}

function matchesRule(token: string, profile: AdminProfile) {
  if (token === "is_master") return profile.is_master === true;
  const prefix = "ruolo:";
  if (token.startsWith(prefix)) {
    const ruolo = token.slice(prefix.length).trim();
    return ruolo.length > 0 && profile.ruolo === ruolo;
  }
  return false;
}
