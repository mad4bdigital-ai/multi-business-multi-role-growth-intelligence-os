export async function generateTaskManifest({
  implementationPlan,
  systemContext = "",
  model = "gpt-4o",
  apiKey = process.env.OPENAI_API_KEY,
  fetchImpl = fetch
}) {
  if (!String(implementationPlan || "").trim()) {
    const err = new Error("taskResolver: implementationPlan is required.");
    err.code = "missing_implementation_plan";
    err.status = 400;
    throw err;
  }

  if (!apiKey) {
    const err = new Error("taskResolver: OPENAI_API_KEY is required but not set in environment.");
    err.code = "missing_openai_api_key";
    err.status = 500;
    throw err;
  }

  const systemMessage = `You are an expert AI architect in execution mode.
Your goal is to receive a detailed implementation plan and output a structured task breakdown.
Output the tasks as a Markdown checklist.
Use the following format for tasks:
- [ ] uncompleted tasks
- Use indented lists for sub-items

Make the tasks granular, sequential, and highly actionable. Ensure there is a logical progression (e.g. setup, implementation, testing, review).`;
  const fullSystemMessage = systemContext
    ? `${systemMessage}\n\nContext about the system:\n${systemContext}`
    : systemMessage;

  const payload = {
    model,
    messages: [
      { role: "system", content: fullSystemMessage },
      { role: "user", content: `Here is the Implementation Plan:\n\n${implementationPlan}` }
    ],
    temperature: 0.2
  };

  const response = await fetchImpl("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`OpenAI API error: ${response.status} - ${errorBody}`);
  }

  const data = await response.json();
  const taskMarkdown = data.choices[0]?.message?.content || "";

  return {
    taskMarkdown,
    usage: data.usage || null,
    provider_interaction: "model_inference",
    provider_write_performed: false,
    tools_executed: false,
    secrets_included: false
  };
}
