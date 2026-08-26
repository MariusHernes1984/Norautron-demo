import type { ChatTurn } from "../types";

const FOLLOW_UP_MARKER = "<<<FOLLOWUPS>>>";
const SAFE_SERVER_MESSAGES = [
  /^Analysen kunne ikke tolkes\.$/,
  /^Bruksgrensen er nådd\./,
  /^Dataanalysen feilet\./,
  /^Databasen er ikke konfigurert\./,
  /^Databasetilgangen ble avvist\./,
  /^Databasespørringen tok for lang tid\./,
  /^Forespørselen /,
  /^Spørsmålet eller samtalehistorikken er ugyldig\.$/,
  /^Tjenesten er midlertidig utilgjengelig\.$/
];

export function visibleNarrative(text: string) {
  const markerIndex = text.indexOf(FOLLOW_UP_MARKER);
  if (markerIndex !== -1) return text.slice(0, markerIndex).trimEnd();

  for (
    let length = Math.min(text.length, FOLLOW_UP_MARKER.length - 1);
    length > 0;
    length -= 1
  ) {
    if (FOLLOW_UP_MARKER.startsWith(text.slice(-length))) {
      return text.slice(0, -length).trimEnd();
    }
  }
  return text;
}

export function chatErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message.trim() : "";
  return SAFE_SERVER_MESSAGES.some((pattern) => pattern.test(message))
    ? message
    : "Chatten kunne ikke fullføres. Prøv igjen.";
}

export function buildChatHistory(turns: ChatTurn[]) {
  const history: Array<Pick<ChatTurn, "role" | "content">> = [];
  let remainingCharacters = 6000;
  for (
    let index = turns.length - 1;
    index >= 0 && history.length < 8 && remainingCharacters > 0;
    index -= 1
  ) {
    const content = turns[index].content.trim();
    if (!content) continue;
    const bounded = content.slice(
      0,
      Math.min(2000, remainingCharacters)
    );
    history.unshift({ role: turns[index].role, content: bounded });
    remainingCharacters -= bounded.length;
  }
  return history;
}
