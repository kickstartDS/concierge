import { serve } from 'https://deno.land/std@0.170.0/http/server.ts'
import 'https://deno.land/x/xhr@0.2.1/mod.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.5.0'
import GPT3Tokenizer from 'https://esm.sh/gpt3-tokenizer@1.1.5'
import { Configuration, OpenAIApi } from 'https://esm.sh/openai@3.1.0'
// import { Configuration, CreateCompletionRequest, OpenAIApi } from 'https://esm.sh/openai@3.1.0'

const openAiKey = Deno.env.get('OPEN_AI_KEY')
const supabaseUrl = Deno.env.get('SUPABASE_URL')
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // Handle CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (!openAiKey) {
    return new Response(
      JSON.stringify({
        error: 'Missing environment variable OPEN_AI_KEY',
      }),
      {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  }

  if (!supabaseUrl) {
    return new Response(
      JSON.stringify({
        error: 'Missing environment variable SUPABASE_URL',
      }),
      {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  }

  if (!supabaseServiceKey) {
    return new Response(
      JSON.stringify({
        error: 'Missing environment variable SUPABASE_SERVICE_ROLE_KEY',
      }),
      {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  }

  // Search query is passed in request payload
  const requestData = await req.json()

  if (!requestData) {
    return new Response(
      JSON.stringify({
        error: 'Missing request data',
      }),
      {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  }
  
  const { question } = requestData
  const sanitizedQuery = question.replace(/\n/g, ' ').trim()

  const supabaseClient = createClient(supabaseUrl, supabaseServiceKey)

  const configuration = new Configuration({ apiKey: openAiKey })
  const openai = new OpenAIApi(configuration)

  const moderationResponse = await openai.createModeration({ input: sanitizedQuery })

  const [results] = moderationResponse.data.results

  if (results.flagged) {
    return new Response(
      JSON.stringify({
        error: 'Flagged content',
        flagged: true,
        categories: results.categories,
      }),
      {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  }

  console.log('RESULTS', results)

  // Generate a one-time embedding for the query itself
  // const embeddingResponse = await openai.createEmbedding({
  //   model: 'text-embedding-ada-002',
  //   input,
  // })

  // const [{ embedding }] = embeddingResponse.data.data

  const body = `{"question": "${sanitizedQuery}"}`;
  const resp = await fetch("https://question-embedding.fly.dev", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body,
  });

  const { embedding } = await resp.json();

  // Fetching whole documents for this simple example.
  //
  // Ideally for context injection, documents are chunked into
  // smaller sections at earlier pre-processing/embedding step.
  const { error: matchError, data: pageSections } = await supabaseClient.rpc('match_sections', {
    query_embedding: embedding,
    similarity_threshold: 0.78, // Choose an appropriate threshold for your data
    match_count: 32, // Choose the number of matches
  })

  if (matchError) {
    console.log(matchError.message)
    throw matchError
  }

  const tokenizer = new GPT3Tokenizer({ type: 'gpt3' })
  let tokenCount = 0
  let contextText = ''

  // Concat matched documents
  for (let i = 0; i < pageSections.length; i++) {
    const pageSection = pageSections[i]
    const content = pageSection.content
    const encoded = tokenizer.encode(content)
    tokenCount += encoded.text.length

    // Limit context to max 1500 tokens (configurable)
    if (tokenCount > 1500) {
      break
    }

    contextText += `${content.trim()}\n---\n`
  }

  const prompt = `You are a very enthusiastic Design System expert who loves to help people! Given the following sections as context, answer the question using only that information, outputted in markdown format. If you are unsure and the answer is not explicitly written in the documentation, say "Sorry, I don't know how to help with that."

    Context sections:
    ${contextText}

    Question: """
    ${sanitizedQuery}
    """

    Answer as markdown (including related code snippets if available):
  `

  // const completionOptions: CreateCompletionRequest = {
  //   model: 'text-davinci-003',
  //   prompt,
  //   max_tokens: 512,
  //   temperature: 0,
  // }

  const completionResponse = await openai.createCompletion({
    model: 'text-davinci-003',
    prompt,
    max_tokens: 512, // Choose the max allowed tokens in completion
    temperature: 0, // Set to 0 for deterministic results
  })

  // const response = await fetch('https://api.openai.com/v1/completions', {
  //   headers: {
  //     Authorization: `Bearer ${openAiKey}`,
  //     'Content-Type': 'application/json',
  //   },
  //   method: 'POST',
  //   body: JSON.stringify(completionOptions),
  // })

  // // TODO: handle response errors
  // if (!response.ok) {
  //   throw new Error('Failed to complete')
  // }

  // // Proxy the streamed SSE response from OpenAI
  // return new Response(response.body, {
  //   headers: {
  //     ...corsHeaders,
  //     'Content-Type': 'text/event-stream',
  //   },
  // })

  const {
    id,
    choices: [{ text }],
  } = completionResponse.data

  return new Response(JSON.stringify({ id, text }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
})
