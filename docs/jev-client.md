> ## Documentation Index
> Fetch the complete documentation index at: https://docs.typesafe.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# Client SDKs

> Install a TypeSafe client SDK and use typed questions and answers in your application.

Our client SDKs provide typed questions and answers for the TypeSafe API and handle retries automatically with their default retry policy.

Choose a client SDK for installation instructions, examples, and API details.

<Card title="Python" href="/sdk/python">
  Install the Python client SDK and make your first request.
</Card>

<Card title="JavaScript / TypeScript" href="/sdk/javascript">
  Install the JavaScript client SDK and make your first typed request.
</Card>

You can also call the [HTTP API](/api) directly from any language.


> ## Documentation Index
> Fetch the complete documentation index at: https://docs.typesafe.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# JavaScript SDK

JavaScript and TypeScript SDK for [TypeSafe AI](https://typesafe.ai).

## Quickstart

Install the SDK (Node.js 20 or newer):

```sh theme={null}
npm install @typesafe-ai/sdk
```

Set `TYPESAFE_API_KEY` in your environment, then create and use the client:

```ts theme={null}
import { choice, TypeSafeClient } from "@typesafe-ai/sdk";

const client = new TypeSafeClient();
const response = await client.systemOne({
  state: { document: "I was charged twice. Please fix this ASAP." },
  questions: {
    category: choice("What is this ticket about?", {
      billing: null,
      technical: null,
      other: null,
    }),
  },
});

console.log(response.answers.category.choice);
```

Answer types are inferred from your questions. The package includes ESM, CommonJS, and TypeScript declarations.

## Documentation

Learn what TypeSafe can do in the [TypeSafe docs](https://docs.typesafe.ai/).
See the SDK's [client](https://github.com/typesafe-ai/typesafe-sdk-js/blob/v0.6.0/src/client.ts) and [types](https://github.com/typesafe-ai/typesafe-sdk-js/blob/v0.6.0/src/types.ts) for API options and defaults.


> ## Documentation Index
> Fetch the complete documentation index at: https://docs.typesafe.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# Changelog

## v0.6.0 (2026-09-15)

### Breaking changes

* accept `Score.criteria` as an ordered sequence instead of a dictionary keyed by integers

## v0.5.7 (2026-09-11)

This is the initial public release of TypeSafe JavaScript and TypeScript SDK. Learn more in the [documentation](https://docs.typesafe.ai/sdk/javascript).


> ## Documentation Index
> Fetch the complete documentation index at: https://docs.typesafe.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# API reference

## Classes

* [APIConnectionError](/sdk/javascript/api/classes/APIConnectionError)
* [APIError](/sdk/javascript/api/classes/APIError)
* [APIPromise](/sdk/javascript/api/classes/APIPromise)
* [APITimeoutError](/sdk/javascript/api/classes/APITimeoutError)
* [APIUserAbortError](/sdk/javascript/api/classes/APIUserAbortError)
* [AuthenticationError](/sdk/javascript/api/classes/AuthenticationError)
* [BadRequestError](/sdk/javascript/api/classes/BadRequestError)
* [InternalServerError](/sdk/javascript/api/classes/InternalServerError)
* [NotFoundError](/sdk/javascript/api/classes/NotFoundError)
* [PermissionDeniedError](/sdk/javascript/api/classes/PermissionDeniedError)
* [RateLimitError](/sdk/javascript/api/classes/RateLimitError)
* [TypeSafeClient](/sdk/javascript/api/classes/TypeSafeClient)
* [TypeSafeError](/sdk/javascript/api/classes/TypeSafeError)
* [UnprocessableEntityError](/sdk/javascript/api/classes/UnprocessableEntityError)

## Interfaces

* [ChoiceQuestion](/sdk/javascript/api/interfaces/ChoiceQuestion)
* [ChoiceResponse](/sdk/javascript/api/interfaces/ChoiceResponse)
* [Logger](/sdk/javascript/api/interfaces/Logger)
* [ModelCard](/sdk/javascript/api/interfaces/ModelCard)
* [Models](/sdk/javascript/api/interfaces/Models)
* [NoulQuestion](/sdk/javascript/api/interfaces/NoulQuestion)
* [NoulResponse](/sdk/javascript/api/interfaces/NoulResponse)
* [Questions](/sdk/javascript/api/interfaces/Questions)
* [RequestOptions](/sdk/javascript/api/interfaces/RequestOptions)
* [RetryPolicy](/sdk/javascript/api/interfaces/RetryPolicy)
* [ScoreQuestion](/sdk/javascript/api/interfaces/ScoreQuestion)
* [ScoreResponse](/sdk/javascript/api/interfaces/ScoreResponse)
* [SystemOneRequest](/sdk/javascript/api/interfaces/SystemOneRequest)
* [SystemOneRequestPayload](/sdk/javascript/api/interfaces/SystemOneRequestPayload)
* [SystemOneResult](/sdk/javascript/api/interfaces/SystemOneResult)
* [TypeSafeClientConfig](/sdk/javascript/api/interfaces/TypeSafeClientConfig)
* [Usage](/sdk/javascript/api/interfaces/Usage)
* [WithResponse](/sdk/javascript/api/interfaces/WithResponse)

## Type Aliases

* [ChoiceCriteria](/sdk/javascript/api/type-aliases/ChoiceCriteria)
* [Description](/sdk/javascript/api/type-aliases/Description)
* [EntryType](/sdk/javascript/api/type-aliases/EntryType)
* [EnvVar](/sdk/javascript/api/type-aliases/EnvVar)
* [Fetch](/sdk/javascript/api/type-aliases/Fetch)
* [JsonValue](/sdk/javascript/api/type-aliases/JsonValue)
* [LogLevel](/sdk/javascript/api/type-aliases/LogLevel)
* [Question](/sdk/javascript/api/type-aliases/Question)
* [ResultFor](/sdk/javascript/api/type-aliases/ResultFor)
* [ScoreCriteria](/sdk/javascript/api/type-aliases/ScoreCriteria)
* [ScoreLegend](/sdk/javascript/api/type-aliases/ScoreLegend)
* [ScoreOf](/sdk/javascript/api/type-aliases/ScoreOf)

## Variables

* [ENV](/sdk/javascript/api/variables/ENV)
* [LOG\_LEVELS](/sdk/javascript/api/variables/LOG_LEVELS)
* [VERSION](/sdk/javascript/api/variables/VERSION)

## Functions

* [choice](/sdk/javascript/api/functions/choice)
* [noul](/sdk/javascript/api/functions/noul)
* [score](/sdk/javascript/api/functions/score)
