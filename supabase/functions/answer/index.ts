import "https://deno.land/x/xhr@0.2.1/mod.ts";
import OpenAI from "https://esm.sh/openai@4.0.0";
import GPT3Tokenizer from "https://esm.sh/gpt3-tokenizer@1.1.5";
import { serve } from "https://deno.land/std@0.170.0/http/server.ts";
import { Stream } from "https://esm.sh/v131/openai@4.0.0/streaming.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.5.0";
import { codeBlock, oneLine } from "https://esm.sh/common-tags@1.8.2";
import { encode } from "https://deno.land/std@0.170.0/encoding/base64.ts";
import { mergeReadableStreams } from "https://deno.land/std@0.170.0/streams/merge_readable_streams.ts";
import { readableStreamFromIterable } from "https://deno.land/std@0.170.0/streams/readable_stream_from_iterable.ts";
import { Database } from "../dbTypes.ts";

const openAiKey = Deno.env.get("OPEN_AI_KEY");
const supabaseUrl = Deno.env.get("SUPABASE_URL");
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

class ApplicationError extends Error {
  constructor(message: string, public data: unknown = {}) {
    super(message);
  }
}

const debug = true;

class UserError extends ApplicationError {}

async function* extractAnswer(
  stream: Stream<OpenAI.Completions.Completion>,
  identifier: string,
  sanitizedQuery: string,
  prompt: string,
  encodedPrompt: {
    bpe: number[];
    text: string[];
  },
  embedding: number[],
  pageSections: Database["public"]["Functions"]["match_sections"]["Returns"]
) {
  if (supabaseUrl && supabaseServiceKey) {
    const supabaseClient = createClient<Database>(
      supabaseUrl,
      supabaseServiceKey
    );

    let answer = "";
    for await (const part of stream) {
      answer += part["choices"][0]["text"];
      yield part;
    }

    if (debug) console.log(identifier, "answer", answer);

    const timestamptz = new Date().toISOString().toLocaleString();
    const { error: questionInsertError, data: dbQuestionResponse } =
      await supabaseClient
        .from("questions")
        .insert({
          created_at: timestamptz,
          updated_at: timestamptz,
          question: sanitizedQuery,
          prompt,
          prompt_length: encodedPrompt.text.length,
          answer: answer && answer.replace("\n", " ").trim(),
          embedding,
        })
        .select();

    if (questionInsertError) {
      throw new ApplicationError(
        "Failed to insert question into DB",
        questionInsertError
      );
    }

    const dbQuestion = dbQuestionResponse[0];
    if (debug) console.log(identifier, "dbQuestion", dbQuestion);

    if (dbQuestion && dbQuestion.id) {
      const answerSections: Database["public"]["Tables"]["question_answer_sections"]["Row"][] =
        [];

      for (let i = 0; i < pageSections.length; i++) {
        const pageSection = pageSections[i];
        answerSections.push({
          question_id: dbQuestion.id,
          section_id: pageSection.id,
          similarity: pageSection.similarity,
        });
      }

      const { error: insertAnswerSectionsError } = await supabaseClient
        .from("question_answer_sections")
        .insert(answerSections);

      if (insertAnswerSectionsError) {
        throw new ApplicationError(
          "Failed to insert answer sections into DB",
          insertAnswerSectionsError
        );
      }
    }
  }
}

serve(async (req) => {
  try {
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: corsHeaders });
    }

    if (!openAiKey) {
      throw new ApplicationError("Missing environment variable OPEN_AI_KEY");
    }

    if (!supabaseUrl) {
      throw new ApplicationError("Missing environment variable SUPABASE_URL");
    }

    if (!supabaseServiceKey) {
      throw new ApplicationError(
        "Missing environment variable SUPABASE_SERVICE_ROLE_KEY"
      );
    }

    const requestData = await req.json();

    const identifier = encode(requestData["question"] || "missing").slice(-7);
    if (debug) console.log(identifier, "requestData", requestData);

    if (!requestData) {
      throw new UserError("Missing request data");
    }

    const { question } = requestData;

    if (!question) {
      throw new UserError("Missing query in request data");
    }

    const sanitizedQuery = question.replace(/\n/g, " ").trim();
    if (debug) console.log(identifier, "sanitizedQuery", sanitizedQuery);

    const supabaseClient = createClient<Database>(
      supabaseUrl,
      supabaseServiceKey
    );

    const openai = new OpenAI({ apiKey: openAiKey });

    const moderationResponse = await openai.moderations.create({
      input: sanitizedQuery,
    });

    const [results] = moderationResponse.results;
    if (debug) console.log(identifier, "moderationResponseResults", results);

    if (results.flagged) {
      throw new UserError("Flagged content", {
        flagged: true,
        categories: results.categories,
      });
    }

    const body = `{"question": "${sanitizedQuery}"}`;
    const embeddingResponse = await fetch(
      "https://question-embedding.fly.dev",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body,
      }
    );

    if (embeddingResponse.status !== 200) {
      throw new ApplicationError(
        "Failed to create embedding for question",
        embeddingResponse
      );
    }

    const { embedding } = await embeddingResponse.json();

    if (debug)
      console.log(identifier, "embedding", embedding.length, embedding);

    const { error: matchError, data: pageSections } = await supabaseClient.rpc(
      "match_sections",
      {
        query_embedding: embedding,
        similarity_threshold: 0.4,
        match_count: 15,
      }
    );

    if (debug)
      console.log(
        identifier,
        `pageSections (#${pageSections?.length})`,
        pageSections
      );

    if (pageSections && pageSections.length === 0) {
      throw new UserError("Failed to find relevant page sections");
    }

    if (matchError) {
      throw new ApplicationError("Failed to match page sections", matchError);
    }

    const tokenizer = new GPT3Tokenizer({ type: "gpt3" });
    let tokenCount = 0;
    let contextText = "";

    for (let i = 0; i < pageSections.length; i++) {
      const pageSection = pageSections[i];
      const content = pageSection.content;
      const encoded = tokenizer.encode(content);
      tokenCount += encoded.text.length;

      if (tokenCount > 2100) {
        break;
      }

      contextText += `${content.trim()}\n---\n`;
    }

    const prompt = codeBlock`
      ${oneLine`
        You are a very enthusiastic Design System expert who loves
        to help people! Given the following sections as "Context sections"",
        answer the "Question" using only that information, outputted
        in markdown format. If you are unsure and the answer is not
        explicitly written about or defined in the "Context sections", say
        "Sorry, I don't know how to help with that."`}

      Context sections:
      ${contextText}

      Question: """
      ${sanitizedQuery}
      """

      Make sure to include at least three paragraphs in your answer. Answer as a Concierge, in markdown format:
    `;

    const encodedPrompt = tokenizer.encode(prompt);
    if (debug)
      console.log(
        identifier,
        "prompt",
        "tokens",
        encodedPrompt.text.length,
        "prompt",
        prompt
      );

    const completionOptions: OpenAI.CompletionCreateParamsStreaming = {
      model: "text-davinci-003",
      prompt,
      max_tokens: 1200,
      temperature: 0,
      stream: true,
    };

    try {
      const stream = await openai.completions.create(completionOptions);

      const answerGenerator = extractAnswer(
        stream,
        identifier,
        sanitizedQuery,
        prompt,
        encodedPrompt,
        embedding,
        pageSections
      );

      const data = `data: ${JSON.stringify({
        pageSections: pageSections,
      })}\n\n`;

      const pageSectionstream = new ReadableStream({
        start(controller) {
          controller.enqueue(data);
          controller.close();
        },
      }).pipeThrough(new TextEncoderStream());

      return new Response(
        mergeReadableStreams(
          pageSectionstream,
          readableStreamFromIterable(answerGenerator).pipeThrough(
            new TextEncoderStream()
          )
        ),
        {
          headers: {
            ...corsHeaders,
            "Content-Type": "text/event-stream",
          },
        }
      );
    } catch (error) {
      if (error instanceof OpenAI.APIError) {
        if (debug)
          console.log(
            identifier,
            "completion error Open AI",
            JSON.stringify(error, null, 2)
          );
        throw new ApplicationError(
          "Failed to generate completion (Open AI)",
          error
        );
      } else {
        if (debug)
          console.log(
            identifier,
            "completion error not Open AI",
            JSON.stringify(error, null, 2)
          );
        throw new ApplicationError(
          "Failed to generate completion (not Open AI)",
          error
        );
      }
    }
  } catch (err: unknown) {
    if (err instanceof UserError) {
      console.warn("UserError", err);

      return new Response(
        JSON.stringify({
          error: err.message,
          data: err.data,
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    } else if (err instanceof ApplicationError) {
      console.error(`${err.message}: ${JSON.stringify(err.data)}`);
    } else {
      console.error(err);
    }

    return new Response(
      JSON.stringify({
        error: "There was an error processing your request",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
