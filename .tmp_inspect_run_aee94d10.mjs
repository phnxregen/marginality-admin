import { createClient } from '@supabase/supabase-js';

const runId = 'aee94d10-ab47-4079-8a8b-62f56709ebcc';
const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data: artifacts, error: artifactsError } = await supabase
  .from('indexing_v2_run_artifacts')
  .select('artifact_type, payload')
  .eq('run_id', runId);
if (artifactsError) throw artifactsError;

const transcriptArtifact = artifacts.find((a) => a.artifact_type === 'raw_transcript_json');
const candidatesArtifact = artifacts.find((a) => a.artifact_type === 'verse_candidates_json');
if (!transcriptArtifact || !candidatesArtifact) {
  throw new Error('Missing artifacts');
}

const segments = transcriptArtifact.payload.segments || [];
const candidates = candidatesArtifact.payload.candidates || [];

const targetRefs = new Set(['Acts 2:1', '1 Corinthians 12:13', 'Ephesians 1:13']);
const targetCandidates = candidates.filter((candidate) => targetRefs.has(candidate.normalized_verse_ref));

const byId = new Map(segments.map((segment) => [segment.segment_id, segment]));

for (const candidate of targetCandidates) {
  const ids = candidate.transcript_span?.segment_ids || candidate.evidence_payload?.supporting_segment_ids || [];
  const firstId = ids[0];
  const startIndex = Math.max(0, segments.findIndex((segment) => segment.segment_id === firstId) - 1);
  const window = segments.slice(startIndex, startIndex + 6).map((segment) => ({
    segment_id: segment.segment_id,
    start_sec: segment.start_sec,
    end_sec: segment.end_sec,
    text: segment.text,
  }));
  console.log(JSON.stringify({
    verse_ref: candidate.normalized_verse_ref,
    timestamp_sec: candidate.timestamp_sec,
    segment_ids: ids,
    excerpt: candidate.evidence_payload?.transcript_excerpt,
    window,
  }, null, 2));
}
