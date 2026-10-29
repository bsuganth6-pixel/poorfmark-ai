import Groq from "groq-sdk";
import Anthropic from "@anthropic-ai/sdk";

export async function llmJson(system: string, user: string): Promise<string> {
  const provider = process.env.LLM_PROVIDER ?? "anthropic";

  if (provider === "groq" && process.env.GROQ_API_KEY) {
    const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
    const res = await groq.chat.completions.create({
      model: process.env.GROQ_MODEL ?? "llama-3.3-70b-versatile",
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system + "\nReturn only valid JSON." },
        { role: "user", content: user },
      ],
    });
    return res.choices[0]?.message?.content ?? "";
  }

  if (process.env.ANTHROPIC_API_KEY) {
    const a = new Anthropic();
    const res = await a.messages.create({
      model: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-5",
      max_tokens: 2000,
      system,
      messages: [{ role: "user", content: user }],
    });
    const block = res.content[0];
    return block.type === "text" ? block.text : "";
  }

  throw new Error("NO_LLM_KEY"); // caller falls back to demo mode
}
