-- Repetix — gratis modell för de lätta AI-funktionerna
--
-- Kör detta i Supabase SQL Editor efter 0008. Idempotent.
--
-- Mappgissning och sortering sorterar in i fack. Ett missat mappförslag kostar
-- ett klick att rätta, till skillnad från de genererande funktionerna där
-- modellskillnaden är själva produkten. De två kan därför köras på Geminis
-- gratisnivå utan att appen blir sämre på det den är till för.
--
-- Kolumnen är ett val och inte en automatik, trots att servern skulle kunna
-- härleda samma sak ur "har användaren en Google-nyckel". Gratisnivån har andra
-- villkor än den betalda — innehållet får användas för att förbättra Googles
-- produkter och kan granskas av människor — och korten är användarens eget
-- material. Att flytta det till en annan leverantör är ett beslut som ska
-- fattas, inte en följd av att en nyckel råkar ligga inne.
--
-- Standard false: den som inte rört inställningen ska inte märka att den finns.

alter table public.user_settings
  add column if not exists ai_light_free boolean not null default false;

comment on column public.user_settings.ai_light_free is
  'Kör autofolder och sort på google/gemini-3-flash i stället för användarens valda leverantör.';
