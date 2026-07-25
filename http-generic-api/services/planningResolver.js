export async function generateImplementationPlan({
  userPrompt,
  systemContext = "",
  model = "gpt-4o",
  apiKey = process.env.OPENAI_API_KEY,
  fetchImpl = fetch
}) {
  if (!String(userPrompt || "").trim()) {
    const err = new Error("planningResolver: userPrompt is required.");
    err.code = "missing_user_prompt";
    err.status = 400;
    throw err;
  }

  if (!apiKey) {
    const err = new Error("planningResolver: OPENAI_API_KEY is required but not set in environment.");
    err.code = "missing_openai_api_key";
    err.status = 500;
    throw err;
  }

  const systemMessage = `You are an expert AI architect in Planning Mode.
Your goal is to receive a high-level user request and generate a detailed, structured implementation plan.
Output the plan in Markdown format.
Include the following sections:
1. Goal Description: What are we trying to achieve?
2. Open Questions: What critical information is missing? (Use GitHub alerts like > [!IMPORTANT])
3. Proposed Architecture: High-level technical design.
4. Proposed Changes: Group by component or file. Use [NEW], [MODIFY], [DELETE] to indicate file operations.
5. Verification Plan: How will this be tested?

Context about the system:
${systemContext}`;

  const payload = {
    model,
    messages: [
      { role: "system", content: systemMessage },
      { role: "user", content: userPrompt }
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
  const planMarkdown = data.choices[0]?.message?.content || "";

  return {
    planMarkdown,
    usage: data.usage || null,
    provider_interaction: "model_inference",
    provider_write_performed: false,
    tools_executed: false,
    secrets_included: false
  };
}
