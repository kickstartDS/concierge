import { serve } from 'https://deno.land/std@0.170.0/http/server.ts'
import 'https://deno.land/x/xhr@0.2.1/mod.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.5.0'
import { codeBlock, oneLine } from 'https://esm.sh/common-tags@1.8.2'
import GPT3Tokenizer from 'https://esm.sh/gpt3-tokenizer@1.1.5'
import { Configuration, CreateCompletionRequest, OpenAIApi } from 'https://esm.sh/openai@3.1.0'

const openAiKey = Deno.env.get('OPEN_AI_KEY')
const supabaseUrl = Deno.env.get('SUPABASE_URL')
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

class ApplicationError extends Error {
  constructor(message: string, public data: Record<string, any> = {}) {
    super(message)
  }
}

class UserError extends ApplicationError {}

serve(async (req) => {
  try {
    if (req.method === 'OPTIONS') {
      return new Response('ok', { headers: corsHeaders })
    }

    if (!openAiKey) {
      throw new ApplicationError('Missing environment variable OPEN_AI_KEY')
    }

    if (!supabaseUrl) {
      throw new ApplicationError('Missing environment variable SUPABASE_URL')
    }

    if (!supabaseServiceKey) {
      throw new ApplicationError('Missing environment variable SUPABASE_SERVICE_ROLE_KEY')
    }

    const requestData = await req.json()

    if (!requestData) {
      throw new UserError('Missing request data')
    }
    
    const { question } = requestData

    if (!question) {
      throw new UserError('Missing query in request data')
    }

    const sanitizedQuery = question.replace(/\n/g, ' ').trim()

    const supabaseClient = createClient(supabaseUrl, supabaseServiceKey)

    const configuration = new Configuration({ apiKey: openAiKey })
    const openai = new OpenAIApi(configuration)

    const moderationResponse = await openai.createModeration({ input: sanitizedQuery })

    const [results] = moderationResponse.data.results

    if (results.flagged) {
      throw new UserError('Flagged content', {
        flagged: true,
        categories: results.categories,
      })
    }

    const body = `{"question": "${sanitizedQuery}"}`;
    const embeddingResponse = await fetch("https://question-embedding.fly.dev", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body,
    });

    if (embeddingResponse.status !== 200) {
      throw new ApplicationError('Failed to create embedding for question', embeddingResponse)
    }

    const { embedding } = await embeddingResponse.json();

    const { error: matchError, data: pageSections } = await supabaseClient.rpc('match_sections', {
      query_embedding: embedding,
      similarity_threshold: 0.78,
      match_count: 32,
    })

    if (matchError) {
      throw new ApplicationError('Failed to match page sections', matchError)
    }

    const tokenizer = new GPT3Tokenizer({ type: 'gpt3' })
    let tokenCount = 0
    let contextText = ''

    for (let i = 0; i < pageSections.length; i++) {
      const pageSection = pageSections[i]
      const content = pageSection.content
      const encoded = tokenizer.encode(content)
      tokenCount += encoded.text.length

      if (tokenCount > 1500) {
        break
      }

      contextText += `${content.trim()}\n---\n`
    }

    const prompt = codeBlock`
      ${oneLine`
        You are a very enthusiastic Design System expert who loves
        to help people! Given the following sections as context,
        answer the question using only that information, outputted
        in markdown format. If you are unsure and the answer is not
        explicitly written in the documentation, say
        "Sorry, I don't know how to help with that."`
      }

      Context sections:
      ${contextText}

      Question: """
      ${sanitizedQuery}
      """

      Answer as markdown (including related code snippets if available):
    `

    const completionOptions: CreateCompletionRequest = {
      model: 'text-davinci-003',
      prompt,
      max_tokens: 512,
      temperature: 0,
      stream: true,
    }

    const response = await fetch('https://api.openai.com/v1/completions', {
      headers: {
        Authorization: `Bearer ${openAiKey}`,
        'Content-Type': 'application/json',
      },
      method: 'POST',
      body: JSON.stringify(completionOptions),
    })

    if (!response.ok) {
      const error = await response.json()
      throw new ApplicationError('Failed to generate completion', error)
    }

    return new Response(response.body, {
      headers: {
        ...corsHeaders,
        'Content-Type': 'text/event-stream',
      },
    })
  } catch (err: unknown) {
    if (err instanceof UserError) {
      return new Response(
        JSON.stringify({
          error: err.message,
          data: err.data,
        }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      )
    } else if (err instanceof ApplicationError) {
      console.error(`${err.message}: ${JSON.stringify(err.data)}`)
    } else {
      console.error(err)
    }

    return new Response(
      JSON.stringify({
        error: 'There was an error processing your request',
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  }
})
