import { serve } from "https://deno.land/std@0.170.0/http/server.ts";
import { OpenAI } from "https://esm.sh/openai@4.60.0";

const openAiKey = Deno.env.get("OPEN_AI_KEY");

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

class UserError extends ApplicationError {}

serve(async (req) => {
  try {
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: corsHeaders });
    }

    if (!openAiKey) {
      throw new ApplicationError("Missing environment variable OPEN_AI_KEY");
    }

    const requestData = await req.json();

    if (!requestData) {
      throw new UserError("Missing request data");
    }

    const { system, prompt, schema } = requestData;

    if (!system) throw new UserError("system is required");
    if (!prompt) throw new UserError("prompt is required");
    if (!schema) throw new UserError("schema is required");

    const client = new OpenAI({ apiKey: openAiKey });
    console.log("before result");
    const result = await client.chat.completions.create({
      messages: [
        {
          role: "system",
          content: system,
        },
        { role: "user", content: prompt },
      ],
      response_format: {
        type: "json_schema",
        json_schema: schema,
      },
      model: "gpt-4o-2024-08-06",
    });
    console.log("after result", JSON.stringify(result));

    return new Response(
      JSON.stringify({ content: result.choices[0].message.content }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
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
