import { describe, expect, it } from "vitest";
import type { ChatTurn } from "../types";
import {
  buildChatHistory,
  chatErrorMessage,
  visibleNarrative
} from "./ui";

describe("chat UI helpers", () => {
  it("never renders complete or partially streamed follow-up markers", () => {
    expect(
      visibleNarrative("Verifisert analyse.<<<FOLLOWUPS>>>[\"Neste?\"]")
    ).toBe("Verifisert analyse.");
    expect(visibleNarrative("Verifisert analyse.<<<FOL")).toBe(
      "Verifisert analyse."
    );
    expect(visibleNarrative("Vanlig svar")).toBe("Vanlig svar");
  });

  it("preserves controlled server errors without exposing unknown details", () => {
    expect(
      chatErrorMessage(new Error("Bruksgrensen er nådd. Prøv igjen om litt."))
    ).toBe("Bruksgrensen er nådd. Prøv igjen om litt.");
    expect(
      chatErrorMessage(new Error("provider secret and full prompt"))
    ).toBe("Chatten kunne ikke fullføres. Prøv igjen.");
  });

  it("bounds recent history to the API contract", () => {
    const turns: ChatTurn[] = Array.from({ length: 12 }, (_, index) => ({
      role: index % 2 === 0 ? "user" : "assistant",
      content: `${index}:`.padEnd(3000, "x")
    }));
    const history = buildChatHistory(turns);
    const characters = history.reduce(
      (total, turn) => total + turn.content.length,
      0
    );

    expect(history).toHaveLength(3);
    expect(history.at(-1)?.content.startsWith("11:")).toBe(true);
    expect(history.every((turn) => turn.content.length <= 2000)).toBe(true);
    expect(characters).toBe(6000);
  });
});
