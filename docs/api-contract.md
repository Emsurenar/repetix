# API-kontrakt

Serverfunktionerna i `api/`. Kontraktet är gemensamt för klienten, serversidan
och inställningsvyn — ändra det här först, inte i någon av implementationerna.

## Varför en server alls

Appen är BYOK: varje användare tar med sin egen API-nyckel. Nyckeln får aldrig
nå webbläsaren, av två skäl. Den ska följa med mellan telefon och dator utan att
klistras in på varje enhet, och en XSS-bugg i klienten ska inte kunna
exfiltrera den. Därför lagras den krypterad och dekrypteras bara inne i
serverfunktionen.

Det löser också att flera leverantörer inte tillåter anrop direkt från en
webbläsare.

## Autentisering

Varje anrop kräver användarens Supabase-token:

```
Authorization: Bearer <supabase access token>
```

Servern verifierar token mot Supabase och härleder `user_id` ur den. Klienten
får aldrig skicka med ett eget användar-id — det vore ett direkt sätt att läsa
någon annans nyckel.

## POST /api/ai

Utför ett AI-anrop med den inloggade användarens nyckel.

```jsonc
// Begäran
{
  "system": "...",
  "user": "...",
  "maxTokens": 1024,
  "json": false,
  "provider": "anthropic",
  "model": "claude-opus-5",
  // Vilken funktion i appen som frågar. Loggas i ai_usage så att panelen kan
  // visa vad pengarna gick till. Servern kan inte härleda det — bara klienten
  // vet varför anropet görs.
  "feature": "topic"
}
```

Två valfria fält styr kostnaden. **Bara Anthropic-adaptern läser dem**; de
övriga tre ignorerar dem tyst, så en klient behöver inte veta vilken leverantör
användaren valt.

```jsonc
{
  // Cachar systemprompten hos leverantören i en timme. Sätts när samma långa
  // text ska frågas om flera gånger — en cachad läsning kostar en tiondel.
  "cache": true,

  // Skär ned modellens tänkande, som debiteras som utdata. Enda tillåtna
  // värdet är "low". Skickas ALDRIG till claude-haiku-4-5, som avvisar
  // parametern; servern utelämnar den då själv.
  "effort": "low"
}
```

```jsonc
// Svar 200
{
  "text": "...",
  "provider": "anthropic",
  "model": "claude-opus-5",
  // Sant när modellen slog i maxTokens och alltså inte hann skriva klart.
  // Utan fältet går ett avhugget svar inte att skilja från ett helt: texten
  // ser komplett ut, den slutar bara mitt i. Klienten kan då säga att svaret
  // avbröts i stället för att visa en halv mening som om den vore hela.
  "truncated": false,
  // Leverantörens egna tokental. Fält som leverantören inte rapporterar är 0.
  "usage": {
    "inputTokens": 12040,
    "outputTokens": 830,
    "cacheReadTokens": 0,
    "cacheWriteTokens": 0
  }
}
```

`feature` är obligatoriskt och högst 40 tecken. Värdet lagras som det kommer,
utan lista över tillåtna värden: ett nytt AI-läge ska inte kräva en migration.

`usage` skrivs också till `ai_usage`. Misslyckas den skrivningen returneras
svaret ändå — en bokföringsrad får aldrig sänka det användaren bad om.

```jsonc
// Fel
{ "error": "Meddelande på svenska", "code": "no_key" }
```

| Kod | HTTP | Betyder |
|---|---|---|
| `unauthorized` | 401 | Ingen eller ogiltig Supabase-token |
| `no_key` | 428 | Användaren har inte lagt in någon nyckel |
| `invalid_key` | 401 | Leverantören avvisade nyckeln |
| `rate_limited` | 429 | Kvoten är förbrukad, eller leverantören svarade 429. Svaret bär `retryAfter` i sekunder |
| `provider_error` | 502 | Leverantören svarade med fel |
| `timeout` | 504 | Leverantören svarade inte inom 45 sekunder |
| `bad_request` | 400 | Felaktig begäran från klienten: fel format, okänd leverantör, eller ett fält över gränsen |
| `server_error` | 500, 503 | Inget av kontraktets fall. Klienten kan bara visa meddelandet |

Timeouten måste ligga **strikt under** `maxDuration` i `vercel.json`. Är de lika
har funktionen noll tid kvar att skriva svaret när signalen löser ut, och
klienten får plattformens HTML-504 i stället för kontraktets JSON — koden
`timeout` går då inte att få. 45 mot 60 sekunder ger den marginalen.

## POST /api/ai-key

Sparar användarens nyckel. Nyckeln verifieras mot leverantören innan den
lagras, så att en felskrivning upptäcks direkt i stället för vid nästa
AI-anrop.

```jsonc
// Begäran
{ "provider": "anthropic", "key": "sk-ant-..." }

// Svar 200
{ "ok": true, "hint": "sk-ant...4f2a", "verified": true }
```

`hint` är de fyra första och fyra sista tecknen. Det räcker för att användaren
ska känna igen vilken nyckel som ligger inne, utan att avslöja den.

## GET /api/ai-key

```jsonc
{ "providers": [{ "provider": "anthropic", "hint": "sk-ant...4f2a", "lastVerified": "2026-08-28T12:00:00Z" }] }
```

Returnerar aldrig chiffertexten: vyn den läser innehåller inte kolumnen.

Chiffertexten kan däremot hämtas av den inloggade själv, för sin egen rad, via
databasfunktionen `get_my_ai_key`. Det är avsiktligt och ofarligt — utan
`AI_KEY_SECRET`, som bara finns i serverns miljö och aldrig i databasen, är
chiffertexten oanvändbar. Det verkliga försvaret är krypteringen, inte att dölja
den krypterade texten.

## DELETE /api/ai-key?provider=anthropic

```jsonc
{ "ok": true }
```

## Gränser

Registreringen är öppen, så en inloggad användare är inte samma sak som ägaren.
Gränserna nedan är inte formsaker: utan dem kan ett nyregistrerat konto binda
hundratals serverfunktioner samtidigt och använda nyckelkontrollen som ett
orakel för skrapade API-nycklar.

### Fältgränser

Överskrids någon av dem svarar servern `bad_request` (400) och säger vilket
fält det gäller. Fälten skickas vidare till leverantören, så ett obegränsat
fält gör slutpunkten till en förstärkare av vår egen utgående bandbredd.

| Fält | Gräns |
|---|---|
| Hela kroppen | 1 MB, avvisas på `content-length` innan den läses |
| `user` | 200 000 tecken |
| `system` | 200 000 tecken |
| `feature` | 40 tecken, obligatoriskt |
| `model` | 128 tecken, och bara `A–Z a–z 0–9 . _ : @ / -` |
| `provider` | 40 tecken, och måste finnas i katalogen |
| `maxTokens` | positivt heltal, kapas till 16 384 |
| `key` (POST /api/ai-key) | 512 tecken, synliga ASCII-tecken utan blanksteg |

Modellkontrollen sitter på det framräknade id:t och inte på fältet i begäran.
Ett modell-id kan komma tre vägar och två av dem är användarens — begäran och
det sparade värdet i `user_settings` — och det interpoleras in i Googles URL.

### Takt-spärr

Räknas per användare i databasen, av `bump_rate_limit` i migration 0004. Fasta
fönster: en rad per användare, slutpunkt och fönster, som stegas uppåt.

| Slutpunkt | Tak |
|---|---|
| `POST /api/ai` | 20 per minut **och** 120 per timme |
| `/api/ai-key` (alla metoder) | 60 per timme |
| `POST /api/ai-key`, nyckelkontrollen | 10 per timme |

Två fönster på `/api/ai` av två skäl. Timfönstret är kostnadstaket. Minutfönstret
är parallellitetstaket, och det är det som skyddar plånboken: ett timtak hindrar
inte att alla 120 anropen görs i samma sekund, och varje anrop håller en
serverfunktion uppbunden i upp till 45 sekunder.

Nyckelkontrollen har det strängaste taket trots att den varken kostar tokens
eller tid, eftersom den skiljer exakt på giltig och ogiltig nyckel. Att lägga in
en nyckel är en handling man gör med handen, någon enstaka gång per leverantör.

Ett stopp ger `rate_limited` (429) med `retryAfter` i sekunder, både i kroppen
och i svarshuvudet `Retry-After`. Avvisade anrop räknas också — annars kunde man
hålla sig precis under taket genom att sluta räknas.

**Spärren stänger när den inte går att nå.** Svarar databasen med fel avvisas
anropet med `server_error` (503). En spärr som öppnar sig när databasen krånglar
är verkningslös just när den behövs som mest, och samma databas läses ändå två
rader längre fram för att hämta nyckeln.

## Leverantörer och modeller

Adaptrarna översätter fyra skillnader: hur nyckeln skickas, var systemprompten
hör hemma, vad tokengränsen heter, och var texten ligger i svaret.

| Leverantör | Auth | Systemprompt | Tokengräns | Svarets text | Avhugget svar |
|---|---|---|---|---|---|
| `anthropic` | `x-api-key` | egen `system`-parameter | `max_tokens` | `content[0].text` | `stop_reason === "max_tokens"` |
| `openai` | `Authorization: Bearer` | meddelande med `role: "system"` | `max_completion_tokens` | `choices[0].message.content` | `choices[0].finish_reason === "length"` |
| `google` | `x-goog-api-key` | `systemInstruction` | `maxOutputTokens` | `candidates[0].content.parts[0].text` | `candidates[0].finishReason === "MAX_TOKENS"` |
| `openrouter` | `Authorization: Bearer` | meddelande med `role: "system"` | `max_tokens` | `choices[0].message.content` | `choices[0].finish_reason === "length"` |

### Modellkatalog

Listan är en bekvämlighet i inställningarna, inte en begränsning: användaren
kan alltid skriva in ett eget modell-id, eftersom leverantörerna släpper nya
modeller oftare än den här appen uppdateras.

Anthropic, standard `claude-opus-5`:
`claude-opus-5`, `claude-sonnet-5`, `claude-haiku-4-5`, `claude-opus-4-8`,
`claude-fable-5`

OpenAI: `gpt-5.1`, `gpt-5.1-mini`, `gpt-5`
Google: `gemini-3-pro`, `gemini-3-flash`
OpenRouter: fritext, formatet är `leverantör/modell`

## Miljövariabler

Serversidan. Ingen av dem får ha `VITE_`-prefix — det skulle bygga in dem i
klientpaketet.

Appen behöver medvetet **ingen** service role-nyckel. Den kringgår all
radnivåsäkerhet, så läcker den ligger varje användares bibliotek öppet — ett
dåligt pris för ett skydd som ändå inte är det verkliga försvaret här.
Serverfunktionerna arbetar i stället med användarens egen token, och migration
0002 ger dem den åtkomst de behöver: en databasfunktion som kör med ägarens
rättigheter men filtrerar på `auth.uid()`, och kan därför bara någonsin
returnera anroparens egen rad.

| Variabel | Syfte |
|---|---|
| `SUPABASE_URL` | Samma projekt som klienten |
| `SUPABASE_ANON_KEY` | Samma publika nyckel som klienten använder |
| `AI_KEY_SECRET` | 32 slumpade byte i base64. Huvudnyckeln som användarnycklarna krypteras med |

## Kryptering

AES-256-GCM. Varje nyckel får en egen slumpad initieringsvektor, och det
lagrade värdet är `iv:authTag:chiffertext` i base64. Autentiseringstaggen gör
att en manipulerad chiffertext avvisas i stället för att dekrypteras till
skräp.

`AI_KEY_SECRET` roteras genom att alla lagrade nycklar ogiltigförklaras och
användarna får lägga in sina på nytt. Det är avsiktligt: alternativet vore att
kunna dekryptera allt med den gamla nyckeln vid en rotation.

## Lokal utveckling

Vercels funktioner körs inte av Vites utvecklingsserver. Handlerna skrivs
därför i Nodes `(req, res)`-form, vilket både Vercel och en Vite-middleware
förstår, och monteras lokalt av en liten plugin. Samma kod kör alltså på båda
ställena i stället för att divergera.
