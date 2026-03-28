import { createClient } from '@supabase/supabase-js';
const runId='f2dfe261-93e4-414d-a950-390663ea825a';
const supabase=createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const {data: artifacts,error}=await supabase.from('indexing_v2_run_artifacts').select('artifact_type,payload').eq('run_id',runId);
if(error) throw error;
const candidates=artifacts.find(a=>a.artifact_type==='verse_candidates_json')?.payload?.candidates||[];
for (const candidate of candidates.filter(c=>String(c.normalized_verse_ref).startsWith('Acts 2:')||String(c.normalized_verse_ref).startsWith('Ephesians 1:')).sort((a,b)=>a.timestamp_sec-b.timestamp_sec)) {
  console.log(candidate.normalized_verse_ref, candidate.timestamp_sec, candidate.resolver_status, candidate.rejection_reason);
}
