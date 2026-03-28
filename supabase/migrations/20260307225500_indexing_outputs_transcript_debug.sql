alter table public.indexing_outputs
  drop constraint if exists indexing_outputs_type_check;

alter table public.indexing_outputs
  add constraint indexing_outputs_type_check
  check (output_type in ('transcript_occurrences', 'ocr_occurrences', 'transcript_debug'));
