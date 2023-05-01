import 'https://deno.land/x/xhr@0.2.1/mod.ts'
import GPT3Tokenizer from 'https://esm.sh/gpt3-tokenizer@1.1.5'
import { serve } from 'https://deno.land/std@0.170.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.5.0'
import { codeBlock, oneLine } from 'https://esm.sh/common-tags@1.8.2'
import { encode } from "https://deno.land/std@0.170.0/encoding/base64.ts"
import { Configuration, CreateCompletionRequest, OpenAIApi } from 'https://esm.sh/openai@3.1.0'
import { Database } from '../dbTypes.ts'

const openAiKey = Deno.env.get('OPEN_AI_KEY')
const supabaseUrl = Deno.env.get('SUPABASE_URL')
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

class ApplicationError extends Error {
  constructor(message: string, public data: unknown = {}) {
    super(message)
  }
}

const debug = true;

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

    const identifier = encode(requestData['keyword'] || 'missing').slice(-7);
    if (debug) console.log(identifier, 'requestData', requestData)

    if (!requestData) {
      throw new UserError('Missing request data')
    }
    
    const { keyword, documents, url } = requestData

    if (!url) {
      throw new UserError('Missing url in request data')
    }

    const supabaseClient = createClient<Database>(supabaseUrl, supabaseServiceKey)

    const { error: urlError, data: urlData } = await supabaseClient.from('descriptions').select(`
      text: description,
      kickstartdsSections:description_kickstartds_sections(sections(id, tokens, content, page_url, page_title, page_summary), similarity),
      externalSections:description_external_sections(sections(id, tokens, content, page_url, page_title, page_summary), similarity)
    `)
    .eq('url', url)
    if (debug) console.log(identifier, 'getting details from DB', urlError, urlData)

    if (!urlError && urlData && urlData.length > 0) {
      const result: {
        text: string,
        kickstartdsSections?: any[],
        externalSections?: any[],
      } = {
        text: urlData[0].text || '',
      }

      if (urlData[0].kickstartdsSections && Array.isArray(urlData[0].kickstartdsSections) && urlData[0].kickstartdsSections.length > 0) {
        result['kickstartdsSections'] = urlData[0].kickstartdsSections.map((section) => {
          return {
            similarity: section.similarity,
            ...section.sections,
          }
        })
      }

      if (urlData[0].externalSections && Array.isArray(urlData[0].externalSections) && urlData[0].externalSections.length > 0) {
        result['externalSections'] = urlData[0].externalSections.map((section) => {
          return {
            similarity: section.similarity,
            ...section.sections,
          }
        })
      }

      if (debug) console.log(identifier, 'returning details from DB')
      return new Response(JSON.stringify(result), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (!keyword) {
      throw new UserError('Missing keyword in request data')
    }

    if (!documents || documents.length === 0) {
      throw new UserError('Missing documents in request data')
    }

    const sanitizedKeyword = keyword.replace(/\n/g, ' ').trim()
    if (debug) console.log(identifier, 'sanitizedKeyword', sanitizedKeyword)

    const configuration = new Configuration({ apiKey: openAiKey })
    const openai = new OpenAIApi(configuration)

    const moderationResponse = await openai.createModeration({ input: sanitizedKeyword })

    const [results] = moderationResponse.data.results
    if (debug) console.log(identifier, 'moderationResponseResults', results)

    if (results.flagged) {
      throw new UserError('Flagged content', {
        flagged: true,
        categories: results.categories,
      })
    }

    const body = `{"question": "The importance of '${sanitizedKeyword}' in the context of Design Systems"}`;
    const embeddingResponse = await fetch("https://question-embedding.fly.dev", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body,
    });

    if (embeddingResponse.status !== 200) {
      throw new ApplicationError('Failed to create embedding for keyword', embeddingResponse)
    }

    const { embedding } = await embeddingResponse.json();

    if (debug) console.log(identifier, 'embedding', embedding.length, embedding)

    const { error: kickstartdsMatchError, data: kickstartdsSections } = await supabaseClient.rpc('match_kickstartds_sections', {
      query_embedding: embedding,
      similarity_threshold: 0.4,
      match_count: 15,
    })

    const { error: externalMatchError, data: externalSections } = await supabaseClient.rpc('match_external_sections', {
      query_embedding: embedding,
      similarity_threshold: 0.4,
      match_count: 15,
    })

    if (debug) console.log(identifier, `kickstartdsSections (#${kickstartdsSections?.length})`, kickstartdsSections)
    if (debug) console.log(identifier, `externalSections (#${externalSections?.length})`, externalSections)

    if (kickstartdsSections && kickstartdsSections.length === 0) {
      throw new UserError('Failed to find relevant kickstartDS page sections')
    }

    if (externalSections && externalSections.length === 0) {
      throw new UserError('Failed to find relevant external page sections')
    }

    if (kickstartdsMatchError) {
      throw new ApplicationError('Failed to match kickstartDS page sections', kickstartdsMatchError)
    }

    if (externalMatchError) {
      throw new ApplicationError('Failed to match external page sections', externalMatchError)
    }

    const tokenizer = new GPT3Tokenizer({ type: 'gpt3' })
    let tokenCount = 0
    let contextText = ''

    for (let i = 0; i < documents.length; i++) {
      const document = documents[i]
      const content = `Type of document #${i}: ${document.type}\nTitle of document #${i}: ${document.title}\nExcerpt of the content of document #${i}: ${document.excerpt}\nURL for document #${i}: ${document.url}\n\n`;
      const encoded = tokenizer.encode(content)
      tokenCount += encoded.text.length

      if (tokenCount > 2100) {
        break
      }

      contextText += `${content.trim()}\n---\n`
    }

    const prompt = codeBlock`
      ${oneLine`
        You are am expert technical writer specialized in writing about Design Systems, 
        who loves to help people! Given the following documents as "Context documents",
        create a description of the keyword "${sanitizedKeyword}" from those
        documents, using only information contained in their excerpts and titles. Include
        as many details as possible from the given "Context documents", and make sure
        to link all relevant keywords in your description to the relevant URLs declared per document!
        Ensure to create at least one paragraph per type of document (e.g. Blog, Appearance, Showcase)!`
      }

      Context sections:
      ${contextText}

      Keyword: """
      ${sanitizedKeyword}
      """

      Make sure to include at least three paragraphs in your description, and link URL for document.
      Answer in markdown format with links to relevant documents:
    `
    
    const encodedPrompt = tokenizer.encode(prompt);
    if (debug) console.log(identifier, 'prompt', 'tokens', encodedPrompt.text.length, 'prompt', prompt)

    const completionOptions: CreateCompletionRequest = {
      model: 'text-davinci-003',
      prompt,
      max_tokens: 1200,
      temperature: 0,
    }

    const completionResponse = await openai.createCompletion(completionOptions);
    const {
      choices: [{ text }],
    } = completionResponse.data

    const timestamptz = ((new Date()).toISOString()).toLocaleString();
    const { error: descriptionInsertError, data: dbDescriptionResponse } = await supabaseClient.from('descriptions').insert({
      created_at: timestamptz,
      updated_at: timestamptz,
      url,
      description: text,
      embedding,
    }).select()

    if (descriptionInsertError) {
      throw new ApplicationError('Failed to insert description into DB', dbDescriptionResponse)
    }

    const dbDescription = dbDescriptionResponse[0];
    if (debug) console.log(identifier, 'dbDescription', dbDescription)

    if (dbDescription && dbDescription.id) {
      const descriptionKickstartdsSections: Database['public']['Tables']['description_kickstartds_sections']['Row'][] = []

      for (let i = 0; i < kickstartdsSections.length; i++) {
        const pageSection = kickstartdsSections[i]
        descriptionKickstartdsSections.push({
          description_id: dbDescription.id,
          section_id: pageSection.id,
          similarity: pageSection.similarity,
        })
      }

      const { error: insertKickstartdsSectionsError } = await supabaseClient.from('description_kickstartds_sections').insert(descriptionKickstartdsSections);

      if (insertKickstartdsSectionsError) {
        throw new ApplicationError('Failed to insert kickstartds sections into DB', insertKickstartdsSectionsError)
      }

      const descriptionExternalSections: Database['public']['Tables']['description_external_sections']['Row'][] = []

      for (let i = 0; i < externalSections.length; i++) {
        const pageSection = externalSections[i]
        descriptionExternalSections.push({
          description_id: dbDescription.id,
          section_id: pageSection.id,
          similarity: pageSection.similarity,
        })
      }

      const { error: insertExternalSectionsError } = await supabaseClient.from('description_external_sections').insert(descriptionExternalSections);

      if (insertExternalSectionsError) {
        throw new ApplicationError('Failed to insert external sections into DB', insertExternalSectionsError)
      }
    }

    const result = { text, kickstartdsSections, externalSections }
    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
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
