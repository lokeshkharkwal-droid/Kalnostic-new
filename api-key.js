import OpenAI from 'openai';

// Testing

const openai = new OpenAI({
  apiKey: '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',
  baseURL: 'https://integrate.api.nvidia.com/v1',
})


async function main() {
  const completion = await openai.chat.completions.create({
    model: "deepseek-ai/deepseek-v4-flash",
    messages: [{ "role": "user", "content": "" }],
    temperature: 1,
    top_p: 0.95,
    max_tokens: 16384,
    chat_template_kwargs: { "thinking": true, "reasoning_effort": "high" },
    stream: false
  })

  const reasoning = completion.choices[0]?.message?.reasoning || completion.choices[0]?.message?.reasoning_content;
  if (reasoning) process.stdout.write(reasoning + "\n");
  process.stdout.write(completion.choices[0]?.message?.content || '');


}

main();