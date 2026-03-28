import { createClient } from '@supabase/supabase-js';

const runId = '2c0e6f92-f008-4807-8ec6-59c2d93038bf';
const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey) throw new Error('Missing env');
const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
const { data: artifacts, error } = await supabase.from('indexing_v2_run_artifacts').select('artifact_type, payload').eq('run_id', runId);
if (error) throw error;
const transcript = artifacts.find((a) => a.artifact_type === 'raw_transcript_json')?.payload?.segments || [];
const candidates = artifacts.find((a) => a.artifact_type === 'verse_candidates_json')?.payload?.candidates || [];
const refs = new Set(['Acts 2:1','Acts 2:1-4','Ephesians 1:13','Ephesians 1:13-14','John 14:16-17','Numbers 11:16-17','Ezekiel 2:1-2','Luke 1:41-42','Luke 1:67-68']);
for (const candidate of candidates.filter((c) => refs.has(c.normalized_verse_ref)).sort((a,b)=>a.timestamp_sec-b.timestamp_sec)) {
  const ids = candidate.transcript_span?.segment_ids || candidate.evidence_payload?.supporting_segment_ids || [];
  const firstId = ids[0];
  const idx = transcript.findIndex((s) => s.segment_id === firstId);
  const window = transcript.slice(Math.max(0, idx - 1), idx + 6).map((s) => ({ id: s.segment_id, text: s.text }));
  console.log(JSON.stringify({ ref: candidate.normalized_verse_ref, timestamp_sec: candidate.timestamp_sec, ids, excerpt: candidate.evidence_payload?.transcript_excerpt, window }, null, 2));
}
