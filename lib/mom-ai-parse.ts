/**
 * Optional: infer Man of the Match from search snippets via a chat model.
 * Set OPENAI_API_KEY (and optionally OPENAI_BASE_URL, OPENAI_MOM_MODEL).
 * Server-only; used from searchWebForMom after regex extraction fails.
 */

function safeString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export async function inferMomFromSnippetsWithAi(opts: {
  searchQuery: string;
  snippets: string[];
}): Promise<string | null> {
  const key = process.env.OPENAI_API_KEY;
  if (!key || opts.snippets.length === 0) return null;

  const model = process.env.OPENAI_MOM_MODEL || "gpt-4o-mini";
  const baseRaw = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
  const base = baseRaw.replace(/\/$/, "");
  const url = `${base}/chat/completions`;

  const lines = opts.snippets.slice(0, 28).map((s, i) => `${i + 1}. ${s.slice(0, 520)}`);
  const userBlock = `Search query: ${opts.searchQuery}\n\nSnippets:\n${lines.join("\n\n")}`.slice(0, 14_000);

  try {
    const res = await fetch(url, {
      method: "POST",
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: 48,
        messages: [
          {
            role: "system",
            content:
              "You read web search snippets about an IPL cricket match. Identify the official Man of the Match / Player of the Match (MoM / POTM) winner if the snippets clearly agree. Reply with exactly one line: the player's full name as in the snippets (e.g. Nitish Kumar Reddy). If snippets omit MoM, conflict, or are only about other awards, reply UNKNOWN.",
          },
          { role: "user", content: userBlock },
        ],
      }),
    });

    if (!res.ok) return null;
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = safeString(data.choices?.[0]?.message?.content);
    if (!text || /^unknown$/i.test(text)) return null;
    const name = text.split("\n")[0]!.replace(/^["']|["']$/g, "").trim();
    if (!name || /^unknown$/i.test(name)) return null;
    if (name.length > 80 || name.length < 3) return null;
    return name;
  } catch {
    return null;
  }
}
