const SQL_KEYWORDS = new Set([
  "select",
  "from",
  "where",
  "group",
  "by",
  "order",
  "having",
  "as",
  "distinct",
  "top",
  "all",
  "join",
  "inner",
  "left",
  "right",
  "full",
  "outer",
  "cross",
  "on",
  "and",
  "or",
  "not",
  "in",
  "like",
  "between",
  "is",
  "null",
  "exists",
  "case",
  "when",
  "then",
  "else",
  "end",
  "iif",
  "asc",
  "desc",
  "over",
  "partition",
  "rank",
  "dense_rank",
  "row_number",
  "ntile",
  "lag",
  "lead",
  "first_value",
  "last_value",
  "count",
  "count_big",
  "sum",
  "avg",
  "min",
  "max",
  "stdev",
  "stdevp",
  "var",
  "varp",
  "string_agg",
  "cast",
  "convert",
  "try_cast",
  "try_convert",
  "coalesce",
  "isnull",
  "nullif",
  "len",
  "datalength",
  "substring",
  "ltrim",
  "rtrim",
  "trim",
  "lower",
  "upper",
  "replace",
  "concat",
  "concat_ws",
  "charindex",
  "round",
  "abs",
  "ceiling",
  "floor",
  "power",
  "sqrt",
  "year",
  "month",
  "day",
  "datepart",
  "datename",
  "datediff",
  "dateadd",
  "datefromparts",
  "eomonth",
  "getdate",
  "getutcdate",
  "sysdatetime",
  "int",
  "bigint",
  "smallint",
  "tinyint",
  "bit",
  "decimal",
  "numeric",
  "float",
  "real",
  "money",
  "smallmoney",
  "char",
  "nvarchar",
  "varchar",
  "nchar",
  "date",
  "datetime",
  "datetime2",
  "smalldatetime",
  "time",
  "datetimeoffset",
  "uniqueidentifier"
]);

export type GuardResult =
  | { ok: true; safe: string; objects: string[] }
  | { ok: false; reason: string };

export type SqlAllowlist = ReadonlyMap<string, ReadonlySet<string>>;

const IDENTIFIER = "[a-z_][a-z0-9_]*";
const SOURCE_PATTERN = new RegExp(
  `^(from|join)\\s+(${IDENTIFIER})\\s*\\.\\s*(${IDENTIFIER})(?:\\s+(?:as\\s+)?(${IDENTIFIER}))?`,
  "i"
);
const QUALIFIED_IDENTIFIER = new RegExp(
  `\\b(${IDENTIFIER})\\s*\\.\\s*(${IDENTIFIER})\\b`,
  "gi"
);

function maskStringLiterals(sql: string): string | null {
  const masked = sql.split("");
  for (let index = 0; index < sql.length; index += 1) {
    if (sql[index] !== "'") continue;
    if (
      index > 0 &&
      /n/i.test(sql[index - 1]) &&
      (index === 1 || !/[a-z0-9_]/i.test(sql[index - 2]))
    ) {
      masked[index - 1] = " ";
    }
    masked[index] = " ";
    let closed = false;
    for (index += 1; index < sql.length; index += 1) {
      masked[index] = " ";
      if (sql[index] !== "'") continue;
      if (sql[index + 1] === "'") {
        masked[index + 1] = " ";
        index += 1;
      } else {
        closed = true;
        break;
      }
    }
    if (!closed) return null;
  }
  return masked.join("");
}

function normalizeBracketedIdentifiers(sql: string): string | null {
  const normalized = sql.replace(
    /\[([a-z_][a-z0-9_]*)\]/gi,
    (_match, identifier: string) => identifier
  );
  return /[\[\]]/.test(normalized) ? null : normalized;
}

function hasBalancedParentheses(sql: string) {
  let depth = 0;
  for (const character of sql) {
    if (character === "(") depth += 1;
    if (character === ")") depth -= 1;
    if (depth < 0) return false;
  }
  return depth === 0;
}

function normalizeAllowlist(allowlist: SqlAllowlist) {
  const normalized = new Map<string, ReadonlySet<string>>();
  for (const [object, columns] of allowlist) {
    normalized.set(
      object.toLowerCase(),
      new Set([...columns].map((column) => column.toLowerCase()))
    );
  }
  return normalized;
}

function capRows(query: string, objects: string[]): GuardResult {
  const prefix =
    /^(\s*select\s+(?:(?:distinct|all)\s+)?)(?:top\s*(?:\(\s*(\d+)\s*\)|(\d+))(?=\s|$))?/i;
  const match = query.match(prefix);
  if (!match) return { ok: false, reason: "Kun SELECT er tillatt." };

  const topKeyword = /^\s*select\s+(?:(?:distinct|all)\s+)?top\b/i.test(query);
  const cap = match[2] ?? match[3];
  if (topKeyword && cap === undefined) {
    return { ok: false, reason: "TOP må være et fast heltall." };
  }
  if (cap !== undefined && Number(cap) <= 500) {
    return { ok: true, safe: query, objects };
  }

  const replacement = `${match[1]}TOP (500) `;
  return {
    ok: true,
    safe:
      cap === undefined
        ? `${replacement}${query.slice(match[1].length)}`
        : `${replacement}${query.slice(match[0].length)}`,
    objects
  };
}

export function validateSelect(
  sql: string,
  allowlist: SqlAllowlist
): GuardResult {
  if (typeof sql !== "string" || !sql.trim()) {
    return { ok: false, reason: "Tom spørring." };
  }

  let cleaned = sql.trim();
  let scan = maskStringLiterals(cleaned);
  if (scan === null) {
    return { ok: false, reason: "Uavsluttet strengliteral." };
  }
  if (/--|\/\*|\*\//.test(scan)) {
    return { ok: false, reason: "SQL-kommentarer er ikke tillatt." };
  }
  if (/["#@]/.test(scan)) {
    return { ok: false, reason: "Variabler og alternative identifikatorer er ikke tillatt." };
  }

  const semicolons = [...scan.matchAll(/;/g)];
  if (
    semicolons.length > 1 ||
    (semicolons.length === 1 && semicolons[0].index !== scan.trimEnd().length - 1)
  ) {
    return { ok: false, reason: "Flere SQL-statements er ikke tillatt." };
  }
  if (semicolons.length === 1) {
    cleaned = cleaned.slice(0, semicolons[0].index).trim();
    scan = maskStringLiterals(cleaned);
    if (scan === null) return { ok: false, reason: "Uavsluttet strengliteral." };
  }

  scan = normalizeBracketedIdentifiers(scan);
  if (scan === null || !hasBalancedParentheses(scan)) {
    return { ok: false, reason: "Ugyldig eller ubalansert SQL-syntaks." };
  }
  if (!/^select\b/i.test(cleaned)) {
    return { ok: false, reason: "Kun en enkel SELECT er tillatt." };
  }

  const forbidden =
    /\b(with|union|except|intersect|insert|update|delete|merge|drop|alter|create|exec|execute|sp_|xp_|grant|revoke|truncate|into|backup|restore|shutdown|waitfor|openrowset|opendatasource|openquery|bulk|offset|fetch)\b/i;
  const match = scan.match(forbidden);
  if (match) {
    return {
      ok: false,
      reason: `Forbudt SQL-uttrykk: ${match[0].toLowerCase()}`
    };
  }

  const selectCount = scan.match(/\bselect\b/gi)?.length ?? 0;
  if (selectCount !== 1) {
    return { ok: false, reason: "Under-spørringer er ikke tillatt." };
  }

  const normalizedAllowlist = normalizeAllowlist(allowlist);
  if (!normalizedAllowlist.size) {
    return { ok: false, reason: "SQL-allowlisten er tom." };
  }

  const referenced = new Map<string, ReadonlySet<string>>();
  const qualifiers = new Map<string, string>();
  const sourceClauses = [...scan.matchAll(/\b(from|join)\b/gi)];
  if (!sourceClauses.length) {
    return { ok: false, reason: "SELECT må lese fra et allowlistet objekt." };
  }
  if (sourceClauses.length > 4) {
    return { ok: false, reason: "For mange datakilder i spørringen." };
  }

  for (const clause of sourceClauses) {
    const source = scan.slice(clause.index).match(SOURCE_PATTERN);
    if (!source) {
      return { ok: false, reason: "Datakilder må oppgis som schema.objekt." };
    }
    const object = `${source[2]}.${source[3]}`.toLowerCase();
    const columns = normalizedAllowlist.get(object);
    if (!columns) {
      return { ok: false, reason: `Objektet er ikke tillatt: ${object}` };
    }
    referenced.set(object, columns);

    const shortName = source[3].toLowerCase();
    const alias =
      source[4] && !SQL_KEYWORDS.has(source[4].toLowerCase())
        ? source[4].toLowerCase()
        : undefined;
    for (const qualifier of [shortName, alias]) {
      if (!qualifier) continue;
      const existing = qualifiers.get(qualifier);
      if (existing && existing !== object) {
        return { ok: false, reason: `Tvetydig tabellalias: ${qualifier}` };
      }
      qualifiers.set(qualifier, object);
    }
  }

  const commaSource = new RegExp(
    `\\bfrom\\s+${IDENTIFIER}\\s*\\.\\s*${IDENTIFIER}(?:\\s+(?:as\\s+)?${IDENTIFIER})?\\s*,`,
    "i"
  );
  if (commaSource.test(scan)) {
    return { ok: false, reason: "Bruk eksplisitt JOIN mellom datakilder." };
  }

  const aliases = new Set<string>();
  for (const alias of scan.matchAll(/\bas\s+([a-z_][a-z0-9_]*)/gi)) {
    aliases.add(alias[1].toLowerCase());
  }
  qualifiers.forEach((_object, alias) => aliases.add(alias));

  let unqualifiedScan = scan;
  for (const qualified of scan.matchAll(QUALIFIED_IDENTIFIER)) {
    const left = qualified[1].toLowerCase();
    const right = qualified[2].toLowerCase();
    const object = `${left}.${right}`;
    if (referenced.has(object)) continue;

    const referencedObject = qualifiers.get(left);
    if (!referencedObject) {
      return { ok: false, reason: `Ukjent objekt eller alias: ${left}` };
    }
    if (!referenced.get(referencedObject)?.has(right)) {
      return {
        ok: false,
        reason: `Kolonnen er ikke tillatt for ${left}: ${right}`
      };
    }
  }
  unqualifiedScan = unqualifiedScan.replace(QUALIFIED_IDENTIFIER, " ");

  const tokens = unqualifiedScan.match(/[a-z_][a-z0-9_]*/gi) ?? [];
  for (const raw of tokens) {
    const token = raw.toLowerCase();
    if (SQL_KEYWORDS.has(token) || aliases.has(token)) {
      continue;
    }
    const matchingObjects = [...referenced.entries()]
      .filter(([, columns]) => columns.has(token))
      .map(([object]) => object);
    if (matchingObjects.length === 1) continue;
    if (matchingObjects.length > 1) {
      return {
        ok: false,
        reason: `Kolonnen må kvalifiseres med tabellalias: ${token}`
      };
    }
    return { ok: false, reason: `Ukjent identifikator: ${token}` };
  }

  const fromIndex = scan.search(/\bfrom\b/i);
  const projection = scan
    .slice(0, fromIndex)
    .replace(/\bcount(?:_big)?\s*\(\s*\*\s*\)/gi, "")
    .replace(
      /^\s*select\s+(?:(?:distinct|all)\s+)?(?:top\s*(?:\(\s*\d+\s*\)|\d+)\s+)?/i,
      ""
    );
  if (new RegExp(`(^|,)\\s*(?:${IDENTIFIER}\\s*\\.\\s*)?\\*`, "i").test(projection)) {
    return { ok: false, reason: "SELECT * er ikke tillatt." };
  }

  return capRows(cleaned, [...referenced.keys()]);
}
