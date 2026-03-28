import { createClient } from '@supabase/supabase-js';
const runId = 'f2dfe261-93e4-414d-a950-390663ea825a';
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const { data: artifacts, error } = await supabase.from('indexing_v2_run_artifacts').select('artifact_type, payload').eq('run_id', runId);
if (error) throw error;
const candidates = artifacts.find((a) => a.artifact_type === 'verse_candidates_json')?.payload?.candidates || [];
for (const candidate of candidates.filter((c) => ['Acts 2:1','Acts 2:1-4','Ephesians 1:13','Ephesians 1:13-14','1 Corinthians 12:13-14'].includes(c.normalized_verse_ref)).sort((a,b)=>a.timestamp_sec-b.timestamp_sec)) {
  console.log(JSON.stringify({
    ref: candidate.normalized_verse_ref,
    ts: candidate.timestamp_sec,
    status: candidate.resolver_status,
    reject: candidate.rejection_reason,
    ids: candidate.transcript_span?.segment_ids,
    excerpt: candidate.evidence_payload?.transcript_excerpt
  }, null, 2));
}
