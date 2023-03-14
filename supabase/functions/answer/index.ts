import 'https://deno.land/x/xhr@0.2.1/mod.ts'
import GPT3Tokenizer from 'https://esm.sh/gpt3-tokenizer@1.1.5'
import { serve } from 'https://deno.land/std@0.170.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.5.0'
import { codeBlock, oneLine } from 'https://esm.sh/common-tags@1.8.2'
import { encode } from "https://deno.land/std@0.170.0/encoding/base64.ts"
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

const debug = true;

class UserError extends ApplicationError {}

interface Question {
  [x: string]: any;
}

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

    const identifier = encode(requestData['question'] || 'missing').slice(-7);
    if (debug) console.log(identifier, 'requestData', requestData)

    if (!requestData) {
      throw new UserError('Missing request data')
    }
    
    const { question } = requestData

    if (!question) {
      throw new UserError('Missing query in request data')
    }

    const sanitizedQuery = question.replace(/\n/g, ' ').trim()
    if (debug) console.log(identifier, 'sanitizedQuery', sanitizedQuery)

    const supabaseClient = createClient(supabaseUrl, supabaseServiceKey)

    const configuration = new Configuration({ apiKey: openAiKey })
    const openai = new OpenAIApi(configuration)

    const moderationResponse = await openai.createModeration({ input: sanitizedQuery })

    const [results] = moderationResponse.data.results
    if (debug) console.log(identifier, 'moderationResponseResults', results)

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

    if (debug) console.log(identifier, 'embedding', embedding.length, embedding)

    const { error: matchError, data: pageSections } = await supabaseClient.rpc('match_sections', {
      query_embedding: embedding,
      similarity_threshold: 0.4,
      match_count: 5,
    })

    if (debug) console.log(identifier, `pageSections (#${pageSections?.length})`, pageSections)

    if (pageSections && pageSections.length === 0) {
      throw new UserError('Failed to find relevant page sections')
    }

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

      if (tokenCount > 2000) {
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
    
    const encodedPrompt = tokenizer.encode(prompt);
    if (debug) console.log(identifier, 'prompt', 'tokens', encodedPrompt.text.length, 'prompt', prompt)

    const completionOptions: CreateCompletionRequest = {
      model: 'text-davinci-003',
      prompt,
      max_tokens: 1000,
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

    const timestamptz = ((new Date()).toISOString()).toLocaleString();
    const { error: questionInsertError, data: dbQuestionResponse } = await supabaseClient.from('questions').insert({
      created_at: timestamptz,
      updated_at: timestamptz,
      question: sanitizedQuery,
      prompt,
      prompt_length: encodedPrompt.text.length,
      answer: 'TODO',
      embedding,
    }).select()

    if (questionInsertError) {
      throw new ApplicationError('Failed to insert question into DB', questionInsertError)
    }

    const dbQuestion: Question = dbQuestionResponse[0];
    if (debug) console.log(identifier, 'dbQuestion', dbQuestion)

    if (dbQuestion && dbQuestion.id) {
      const answerSections = []

      for (let i = 0; i < pageSections.length; i++) {
        const pageSection = pageSections[i]
        answerSections.push({
          question_id: dbQuestion.id,
          section_id: pageSection.id,
          similarity: pageSection.similarity,
        })
      }

      const { error: insertAnswerSectionsError } = await supabaseClient.from('question_answer_sections').insert(answerSections);

      if (insertAnswerSectionsError) {
        throw new ApplicationError('Failed to insert answer sections into DB', insertAnswerSectionsError)
      }
    }

    return new Response(response.body, {
      headers: {
        ...corsHeaders,
        'Content-Type': 'text/event-stream',
      },
    })
  } catch (err: unknown) {
    if (err instanceof UserError) {
      console.warn('UserError', err)

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
