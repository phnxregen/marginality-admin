import { createClient } from '@supabase/supabase-js';
const youtubeVideoId = '3Hk-scIE6fw';
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const queries = {};
queries.videos = await supabase
  .from('videos')
  .select('id, external_video_id, source_video_id, canonical_source_video_id')
  .or(`external_video_id.eq.${youtubeVideoId},source_video_id.eq.${youtubeVideoId},canonical_source_video_id.eq.${youtubeVideoId}`)
  .limit(10);
queries.transcriptSegmentsBySource = await supabase
  .from('transcript_segments')
  .select('source_video_id, video_id, start_ms, end_ms, text')
  .or(`source_video_id.eq.${youtubeVideoId},video_id.eq.${youtubeVideoId}`)
  .limit(5);
queries.indexingRunsTranscript = await supabase
  .from('indexing_runs')
  .select('id, video_id, phase, status, meta, duration_ms, created_at')
  .eq('phase', 'transcript_acquisition')
  .or(`video_id.eq.${youtubeVideoId}`)
  .order('created_at', { ascending: false })
  .limit(10);
queries.indexingOutputs = await supabase
  .from('indexing_outputs')
  .select('id, video_id, output_type, created_at')
  .or(`video_id.eq.${youtubeVideoId}`)
  .order('created_at', { ascending: false })
  .limit(20);
for (const [name, result] of Object.entries(queries)) {
  console.log('\n## ' + name);
  if (result.error) {
    console.log(JSON.stringify({ error: result.error.message }, null, 2));
  } else {
    console.log(JSON.stringify(result.data, null, 2));
  }
}
