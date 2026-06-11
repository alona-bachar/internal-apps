# Wonderful Communications API — Reference

Tenant-scoped calls, chats, and other communication artifacts. Includes audio recordings (pre-signed S3 URLs) and per-segment transcripts.

## Endpoints

```
GET    /api/v1/communications                       list with filters + pagination     ⚠️ `filters` param REQUIRED
GET    /api/v1/communications/{id}                  full DTO with transcripts + recording_url
GET    /api/v1/communications/{id}/live             WebSocket: live transcript stream (voice only)
GET    /api/v1/communications/{id}/transcripts/{transcript_id}
POST   /api/v1/communications/{id}/translate
GET    /api/v1/communications/{id}/latency-pipeline
GET    /api/v1/communications/{id}/latency-breakdown
GET    /api/v1/communications/{id}/context-health
POST   /api/v1/communications/{id}/review
POST   /api/v1/communications/{id}/enhance

GET    /api/v1/communications/enhanced              list with full transcripts inline
GET    /api/v1/communications/numbers / emails / agents / metadata-keys / metadata-values / metric-names
GET    /api/v1/communications/statistics
GET    /api/v1/communications/listening-queue       reviewable items
GET    /api/v1/communications/listening-queue/reviewed
POST   /api/v1/communications/listening-queue/{id}/feedback
GET    /api/v1/communications/listening-queue/{id}/feedback

PUT    /api/v1/communications/{id}/tags             requires Tags:Edit
POST   /api/v1/communications/{id}/bookmark/{entity_type}
DELETE /api/v1/communications/{id}/bookmark/{entity_type}

# v2 returns the V2 DTO (slightly different shape but functionally equivalent for our needs)
GET    /api/v2/communications
GET    /api/v2/communications/{id}
GET    /api/v2/communications/enhanced
GET    /api/v2/communications/count
```

## **CRITICAL — `filters` query param is REQUIRED on listing**

`GET /api/v1/communications` returns 500 if you omit `filters=`. An empty object works:

```sh
GET /api/v1/communications?filters=%7B%7D&page=1&limit=20
```

`filters` is a JSON object (not array) with keys per filterable field. Example:

```json
{
  "type":       ["voice", "chat"],
  "status":     ["completed"],
  "agent_id":   "uuid-of-agent",
  "startDate":  1640995200,
  "endDate":    1641081600
}
```

Pagination uses `page` and `limit` (NOT `page_size`).

Response envelope:

```json
{
  "data": [/* CommunicationDTOV1[] */],
  "pagination": { "limit": 20, "page": 1, "sort": "created_at desc", "total_rows": 182, "total_pages": 10 },
  "status": 200
}
```

## DTO shape (V1, what `GET /{id}` returns)

`EnhancedCommunicationDTOV1` extends `CommunicationDTOV1`:

```ts
{
  // Identity
  id, tenant_id, type, interactor, direction, sid,
  agent_id, agent_version, locale, status,

  // Time (ms epoch)
  start_time, end_time, duration,

  // Phone / email
  from_number, to_number, customer_number, from_email,

  // Content
  sentiment: { value, reason } | undefined,
  summary:   { brief, detailed, points[] } | undefined,
  reviewed_by, reviewed_at,
  tags: [...], call_tags: [...], metadata: {...},

  // Token usage
  tokens_usage: { total_input_tokens, total_cached_input_tokens, total_output_tokens, ... },
  qa_score,
  call_rating, rating,

  // Recordings (presigned URLs, only returned by GET /{id} — NOT by /communications listing)
  recording_url:           string | null,
  processed_recording_url: string | null,
  masked_recording_url:    string | null,
  masked_mp3_recording_url:string | null,

  // Storage keys (returned by both endpoints — useful for testing whether a recording exists)
  recording_s3_key, processed_audio_s3_key, masked_audio_s3_key, masked_recording_s3_key,

  // Transcripts (inline on enhanced endpoints)
  transcriptions: CommTranscriptionDTO[],

  // Bookmarks, human feedback, metrics
  bookmarked, human_feedback, metrics
}
```

`CommTranscriptionDTO` per segment:

```ts
{
  id, communication_id,
  speaker:   "agent" | "customer" | "system" | string,
  text:      string,                  // verbatim text
  phonemized_text?: string,           // TTS hint with vowel/diacritic markers — NOT what was heard
  enhanced_text?:   string,
  sequence?: number,
  start_time?: number,                // ms epoch (NOT seconds-from-start)
  end_time?:   number,                // ms epoch
  confidence?: number,
  wpm?:        number,
  gender?:     string,
  masking_status, masked_items_timings, masked_pii_markers,
  tool_details?: ToolDetails | null,  // present on "system" entries that wrap a tool call
  is_eot?: boolean,
  origin?: TranscriptionOrigin,
  issues: [...]
}
```

## Normalizing transcripts for analysis

When using these transcripts as input to an analysis pipeline (e.g. comparing against a fresh ASR transcription):

1. **Drop "system" entries.** Any segment with `speaker === "system"`, or that carries a `tool_details` object, is not real speech — it's the runtime logging a tool call or state change. Same for speakers in `{"tool", "function", "bot", "internal"}`.
2. **Drop empty `text` entries.**
3. **Rebase timestamps.** `start_time` / `end_time` are millisecond epoch values. Subtract the minimum to get seconds-from-call-start: `t_sec = (t_ms - minStart) / 1000`.
4. **Preserve speaker labels** — they're stable across the call ("agent", "customer", "S1", etc.) and are the right axis to align against a verbatim ASR pass.

Reference normalizer (TypeScript):

```ts
function transcriptFromCommunication(comm: any) {
  const SYSTEM = new Set(["system", "tool", "function", "bot", "internal"]);
  const raw = Array.isArray(comm?.transcriptions) ? comm.transcriptions : [];
  const kept = raw.filter((s: any) => {
    if (!s?.text?.trim()) return false;
    if (s.tool_details && typeof s.tool_details === "object") return false;
    return !SYSTEM.has(String(s.speaker ?? "").toLowerCase());
  });
  if (kept.length === 0) return { segments: [], language: comm?.locale };

  const starts = kept.map((s: any) => s.start_time).filter((n: any) => typeof n === "number");
  const isMs   = starts.length > 0 && starts.every((n: number) => n > 1e10);
  const minStart = starts.length > 0 ? Math.min(...starts) : 0;
  const toSec = (n?: number) =>
    typeof n !== "number" ? undefined : isMs ? (n - minStart) / 1000 : n;

  return {
    language: comm?.locale,
    segments: kept.map((s: any) => ({
      speaker: s.speaker,
      text:    String(s.text).trim(),
      start:   toSec(s.start_time),
      end:     toSec(s.end_time),
    })),
  };
}
```

## Recording URLs and MIME

`recording_url`, `processed_recording_url`, `masked_recording_url`, `masked_mp3_recording_url` are presigned S3 URLs. Download with plain `fetch(url)` — NO `X-api-key` header (it's a direct S3 hit; signing is embedded in the query string).

**MIME gotcha:** S3 typically returns `Content-Type: application/octet-stream`. Gemini and most ASR APIs reject anything that doesn't start with `audio/...`. Detect MIME via:

1. The HTTP response's `Content-Type` (only if it starts with `audio/`).
2. The URL path extension (most paths end with no extension or `.mp3`).
3. The audio's magic bytes (ID3 / MPEG sync / RIFF…WAVE / fLaC / OggS).
4. Fallback to `audio/mpeg` — most Wonderful recordings are mp3.

Reference detector:

```ts
function detectAudioMime(url: string, headerType: string | null, bytes: Uint8Array): string {
  if (headerType && headerType.startsWith("audio/")) return headerType;
  try {
    const path = new URL(url).pathname.toLowerCase();
    if (path.endsWith(".mp3"))  return "audio/mpeg";
    if (path.endsWith(".wav"))  return "audio/wav";
    if (path.endsWith(".flac")) return "audio/flac";
    if (path.endsWith(".m4a") || path.endsWith(".mp4") || path.endsWith(".aac")) return "audio/mp4";
    if (path.endsWith(".ogg") || path.endsWith(".opus")) return "audio/ogg";
    if (path.endsWith(".webm")) return "audio/webm";
  } catch {}
  // Magic bytes
  if (bytes.length >= 3 && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) return "audio/mpeg";  // ID3
  if (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1]! & 0xe0) === 0xe0) return "audio/mpeg";              // MPEG sync
  if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
      bytes[8] === 0x57 && bytes[9] === 0x41 && bytes[10] === 0x56 && bytes[11] === 0x45) return "audio/wav"; // RIFF…WAVE
  if (bytes.length >= 4 && bytes[0] === 0x66 && bytes[1] === 0x4c && bytes[2] === 0x61 && bytes[3] === 0x43) return "audio/flac"; // fLaC
  if (bytes.length >= 4 && bytes[0] === 0x4f && bytes[1] === 0x67 && bytes[2] === 0x67 && bytes[3] === 0x53) return "audio/ogg";  // OggS
  return "audio/mpeg";
}
```

## Recording-start lag

Voice recordings often miss the first few seconds — the agent's TTS greeting plays before the audio stream actually starts recording. Result: the existing transcript has `[agent] hello, this is …` at t=0–3s but the recording's first segment starts at t=4s with silence.

When comparing two transcripts of the same call, treat **empty Gemini side** as recording artifact, not as a "transcript invented content" anomaly. Either filter in the prompt ("skip when GEMINI side is empty") or post-filter on `gemini.text.trim().length === 0`.
