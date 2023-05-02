<p align="center">
  <a href="https://www.kickstartDS.com/">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://www.kickstartds.com/docs/img/logo-light.svg">
      <img src="https://www.kickstartDS.com/logo.svg" alt="kickstartDS" width="400" />
    </picture>
  </a>
</p>

# kickstartDS Concierge - Your AI-powered Design System assistant

This repository contains all code related to the kickstartDS Concierge hosted at https://www.kickstartDS.com/concierge/

Read more about its release on our blog post:  
https://www.kickstartDS.com/blog/launching-the-design-system-concierge/

For a more detailed overview of the architecture, design decisions and some code... have a look at the following Miro board:  
https://miro.com/app/board/uXjVMdpB0ao=/

![Screenshot of the Design System Concierge](assets/screenshot-concierge.png)

The Concierge can answer user questions by pulling from a big Design System-related knowledge base, gained by scraping manually curated domains on the web.

Crawled HTML gets processed, sections of content are split from it along headline elements, and some metadata is enriched. Finally those sections get transformed to an embedding vector space that is saved to a PostgreSQL database using the `pgvector` extension.

Requests from the page are sent to a Supabase Edge Function, which get's an embedding for the question by calling the Flask webservice contained within this repository. This embedding is then sent to the database to get back the most relevant sections in relation to the question. This then, finally, gets embedded as context into a GPT Completion prompt, which generates the final answer being streamed back to the user. Additionally links and a preview to all referenced pages gets included as context.

## Flask webservice

### Run locally

Run app first:

```
FLASK_APP=app flask run
```

Now send questions to the locally running service:

```
curl -d '{"question": "What is a Design System?"}' -H "Content-Type: application/json" -X POST http://127.0.0.1:5000
```

### Run on Fly.io

Install `flyctl` first. E.g. Arch Linux:

```
trizen -S flyctl-bin
```

Log in to your account with `flyctl`:

```
flyctl auth login
```

Deploy a version:

```
flyctl deploy
```

Query the running webservice:

```
curl -d '{"question": "What is a Design System?"}' -H "Content-Type: application/json" -X POST https://question-embedding.fly.dev
```

## Database

This project uses PostgreSQL for data storage, and `pgvector` as an extension specifically:  
https://github.com/pgvector/pgvector

### Installation

Needed tables are generated by `notebooks/create_knowledge_base.ipynb` when `seed = True` is set in cell "Write embeddings to DB".

But you'll need the following `pgsql` database function:

```pgsql
drop function match_sections (
  query_embedding vector(768),
  similarity_threshold float,
  match_count int
);
create or replace function match_sections (
  query_embedding vector(768),
  similarity_threshold float,
  match_count int
)
returns table (
  id bigint,
  tokens integer,
  content text,
  page_url text,
  page_title text,
  page_summary text,
  similarity float
)
language plpgsql
as $$
begin
  return query
  select
    sections.id,
    sections.tokens,
    sections.content,
    sections.page_url,
    sections.page_title,
    sections.page_summary,
    1 - (sections.embedding <=> query_embedding) as similarity
  from sections
  where 1 - (sections.embedding <=> query_embedding) > similarity_threshold
  order by sections.embedding <=> query_embedding
  limit match_count;
end;
$$;
```

### Supabase

You will need an account with Supabase to use this repository for yourself directly. But it should be easily adaptable to other hosters, too!

#### Create database function

1. Go to the "SQL editor" section.
2. Click "New Query".
3. Enter the above SQL to create or replace your Database function.
4. Click "Run" or cmd+enter (ctrl+enter).

See also: https://supabase.com/docs/guides/database/functions

#### Create edge function

1. Install Supabase CLI: https://supabase.com/docs/guides/cli
2. Deploy edge function: `yarn supabase functions deploy answer`

Optionally integrate the Deno language server with your editor for autocompletion, etc:  
https://deno.land/manual/getting_started/setup_your_environment

See also: https://supabase.com/docs/guides/functions/quickstart

#### Create database types

```
yarn supabase gen types typescript --db-url postgres://postgres:YOUR_POSTGRES_PASS@YOUR_POSTGRES_URL:5432/postgres > dbTypes.ts
```

## Contributing

Unless you explicitly state otherwise, any contribution intentionally submitted
for inclusion in the work by you, as defined in the Apache-2.0 license, shall be
dual licensed as below, without any additional terms or conditions.

## License

&copy; Copyright 2023 Jonas Ulrich, kickstartDS by ruhmesmeile GmbH [jonas.ulrich@kickstartds.com].

This project is licensed under either of

- [Apache License, Version 2.0](https://www.apache.org/licenses/LICENSE-2.0) ([`LICENSE-APACHE`](LICENSE-APACHE))
- [MIT license](https://opensource.org/licenses/MIT) ([`LICENSE-MIT`](LICENSE-MIT))

at your option.

The [SPDX](https://spdx.dev) license identifier for this project is `MIT OR Apache-2.0`.
