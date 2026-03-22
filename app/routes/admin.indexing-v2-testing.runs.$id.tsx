import type { LoaderFunctionArgs } from "@remix-run/node";
import { Link, useLoaderData, useRevalidator } from "@remix-run/react";
import { useEffect } from "react";

import { requireAdmin } from "~/lib/admin.server";
import { getIndexingV2RunDetailPayload } from "~/lib/indexing-v2-testing.server";

type LoaderData = NonNullable<Awaited<ReturnType<typeof getIndexingV2RunDetailPayload>>>;

function formatTimestamp(totalSeconds: number): string {
  const rounded = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const seconds = rounded % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requireAdmin(request);
  const runId = params.id;
  if (!runId) {
    throw new Response("Run ID is required", { status: 400 });
  }

  const payload = await getIndexingV2RunDetailPayload(runId);
  if (!payload) {
    throw new Response("Run not found", { status: 404 });
  }

  return Response.json(payload);
}

export default function IndexingV2RunDetailRoute() {
  const payload = useLoaderData<LoaderData>();
  const revalidator = useRevalidator();
  const isActiveRun =
    payload.run.status === "queued" ||
    payload.run.status === "transcribing" ||
    payload.run.status === "analyzing" ||
    payload.run.status === "resolving";

  useEffect(() => {
    if (!isActiveRun) {
      return undefined;
    }

    const intervalId = window.setInterval(() => {
      if (revalidator.state === "idle") {
        revalidator.revalidate();
      }
    }, 5_000);

    return () => window.clearInterval(intervalId);
  }, [isActiveRun, revalidator]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Run Detail</h2>
          <p className="mt-1 text-sm text-slate-600">
            Occurrence-first review for V2 run `{payload.run.id}`.
          </p>
        </div>

        <div className="flex gap-2">
          <Link
            to="/admin/indexing-v2-testing"
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
          >
            Back to Runs
          </Link>
          <a
            href={`/admin/indexing-v2-testing/runs/${payload.run.id}/occurrences.json`}
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
          >
            Occurrences JSON
          </a>
          <a
            href={`/admin/indexing-v2-testing/runs/${payload.run.id}/candidates.json`}
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
          >
            Candidates JSON
          </a>
          <a
            href={`/admin/indexing-v2-testing/runs/${payload.run.id}/validation.json`}
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
          >
            Validation JSON
          </a>
        </div>
      </div>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-lg bg-white p-4 shadow">
          <p className="text-xs uppercase tracking-wide text-slate-500">Status</p>
          <p className="mt-2 text-lg font-semibold text-slate-900">{payload.run.status}</p>
          <p className="mt-2 text-sm text-slate-600">Run mode: {payload.run.run_mode}</p>
          <p className="mt-1 text-sm text-slate-600">Pipeline: {payload.run.pipeline_version}</p>
        </div>

        <div className="rounded-lg bg-white p-4 shadow">
          <p className="text-xs uppercase tracking-wide text-slate-500">Timing</p>
          <p className="mt-2 text-lg font-semibold text-slate-900">{payload.run.timing_authority}</p>
          <p className="mt-2 text-sm text-slate-600">
            confidence {payload.run.timing_confidence?.toFixed(2) || "—"}
          </p>
          <p className="mt-1 text-sm text-slate-600">{payload.run.execution_mode}</p>
        </div>

        <div className="rounded-lg bg-white p-4 shadow">
          <p className="text-xs uppercase tracking-wide text-slate-500">Counts</p>
          <p className="mt-2 text-sm text-slate-600">
            {payload.summary.resolved_occurrence_count} occurrences
          </p>
          <p className="mt-1 text-sm text-slate-600">{payload.summary.candidate_count} candidates</p>
          <p className="mt-1 text-sm text-slate-600">{payload.summary.warning_count} warnings</p>
        </div>

        <div className="rounded-lg bg-white p-4 shadow">
          <p className="text-xs uppercase tracking-wide text-slate-500">Upstream Context</p>
          <p className="mt-2 text-sm text-slate-600">Video ID: {payload.run.youtube_video_id}</p>
          <p className="mt-1 text-sm text-slate-600">Source: {payload.run.transcript_source || "—"}</p>
          <p className="mt-1 text-sm text-slate-600">Lane: {payload.run.lane_used || "—"}</p>
        </div>
      </section>

      {payload.warnings.length > 0 && (
        <section className="rounded-lg border border-amber-300 bg-amber-50 p-4">
          <h3 className="text-sm font-semibold text-amber-900">Validation Warnings</h3>
          <ul className="mt-3 space-y-2 text-sm text-amber-900">
            {payload.warnings.map((warning) => (
              <li key={`${warning.code}-${warning.occurrence_id || "none"}`}>
                <span className="font-medium">{warning.code}:</span> {warning.message}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="grid gap-6 xl:grid-cols-[1.2fr_1fr]">
        <div className="rounded-lg bg-white p-4 shadow">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-900">Player</h3>
            <a
              href={payload.player.youtube_url}
              target="_blank"
              rel="noreferrer"
              className="text-sm text-cyan-700 hover:text-cyan-800"
            >
              Open on YouTube
            </a>
          </div>
          <div className="mt-4 aspect-video overflow-hidden rounded-lg bg-slate-100">
            <iframe
              title={`YouTube video ${payload.player.youtube_video_id}`}
              src={payload.player.embed_url}
              className="h-full w-full"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          </div>
        </div>

        <div className="rounded-lg bg-white p-4 shadow">
          <h3 className="text-sm font-semibold text-slate-900">Artifacts</h3>
          <div className="mt-4 space-y-3">
            {payload.available_artifacts.length === 0 ? (
              <p className="text-sm text-slate-500">No downloadable artifacts found.</p>
            ) : (
              payload.available_artifacts.map((artifact) => (
                <a
                  key={artifact.artifact_id}
                  href={artifact.download_url}
                  className="flex items-center justify-between rounded-md border border-slate-200 px-3 py-3 text-sm text-slate-700 hover:bg-slate-50"
                >
                  <span>{artifact.label}</span>
                  <span className="text-xs text-slate-500">
                    {artifact.size_bytes ? `${artifact.size_bytes} bytes` : "download"}
                  </span>
                </a>
              ))
            )}
          </div>
        </div>
      </section>

      <section className="rounded-lg bg-white p-4 shadow">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">Resolved Occurrences</h3>
            <p className="mt-1 text-sm text-slate-600">
              Ordered by canonical timestamp. Candidate lineage and snippets come from persisted V2 data.
            </p>
          </div>
        </div>

        <div className="mt-4 space-y-4">
          {payload.resolved_occurrences.length === 0 ? (
            <p className="text-sm text-slate-500">No resolved occurrences were produced.</p>
          ) : (
            payload.resolved_occurrences.map((occurrence) => (
              <article key={occurrence.occurrence_id} className="rounded-lg border border-slate-200 p-4">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <p className="text-xs uppercase tracking-wide text-slate-500">
                      {occurrence.occurrence_type}
                    </p>
                    <h4 className="mt-1 text-lg font-semibold text-slate-900">{occurrence.verse_ref}</h4>
                    <p className="mt-1 text-sm text-slate-600">
                      {formatTimestamp(occurrence.canonical_timestamp_sec)} · confidence{" "}
                      {occurrence.confidence.toFixed(2)} · {occurrence.timing_authority}
                    </p>
                  </div>

                  <a
                    href={`${payload.player.youtube_url}&t=${Math.max(0, Math.floor(occurrence.canonical_timestamp_sec))}s`}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-md border border-cyan-300 bg-cyan-50 px-3 py-2 text-sm text-cyan-900 hover:bg-cyan-100"
                  >
                    Jump to {formatTimestamp(occurrence.canonical_timestamp_sec)}
                  </a>
                </div>

                <div className="mt-4 grid gap-4 md:grid-cols-[2fr_1fr]">
                  <div>
                    <p className="text-xs uppercase tracking-wide text-slate-500">Snippet</p>
                    <p className="mt-2 text-sm text-slate-800">
                      {occurrence.snippet_text || "No transcript snippet found near the canonical timestamp."}
                    </p>
                  </div>

                  <div>
                    <p className="text-xs uppercase tracking-wide text-slate-500">Evidence Summary</p>
                    <dl className="mt-2 space-y-1 text-sm text-slate-700">
                      <div className="flex justify-between gap-4">
                        <dt>Fusion rule</dt>
                        <dd>{occurrence.evidence_summary.fusion_rule}</dd>
                      </div>
                      <div className="flex justify-between gap-4">
                        <dt>Transcript candidates</dt>
                        <dd>{occurrence.evidence_summary.transcript_candidate_count}</dd>
                      </div>
                      <div className="flex justify-between gap-4">
                        <dt>OCR candidates</dt>
                        <dd>{occurrence.evidence_summary.ocr_candidate_count}</dd>
                      </div>
                    </dl>
                  </div>
                </div>

                <div className="mt-4">
                  <p className="text-xs uppercase tracking-wide text-slate-500">Candidate Lineage</p>
                  <div className="mt-2 overflow-x-auto">
                    <table className="min-w-full divide-y divide-slate-200 text-sm">
                      <thead className="bg-slate-50 text-left text-slate-600">
                        <tr>
                          <th className="px-3 py-2 font-medium">Source</th>
                          <th className="px-3 py-2 font-medium">Verse</th>
                          <th className="px-3 py-2 font-medium">Time</th>
                          <th className="px-3 py-2 font-medium">Confidence</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {occurrence.fused_candidate_ids.map((candidateId) => {
                          const candidate = payload.evidence_index[candidateId];
                          if (!candidate) {
                            return null;
                          }
                          return (
                            <tr key={candidateId}>
                              <td className="px-3 py-2 text-slate-700">{candidate.source_type}</td>
                              <td className="px-3 py-2 text-slate-700">{candidate.verse_ref}</td>
                              <td className="px-3 py-2 text-slate-700">
                                {formatTimestamp(candidate.timestamp_sec)}
                              </td>
                              <td className="px-3 py-2 text-slate-700">
                                {candidate.confidence.toFixed(2)} ·{" "}
                                {candidateId === occurrence.canonical_candidate_id ? "canonical" : "support"}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </article>
            ))
          )}
        </div>
      </section>

      {payload.validation && (
        <section className="rounded-lg bg-white p-4 shadow">
          <h3 className="text-sm font-semibold text-slate-900">Validation Report</h3>
          <p className="mt-1 text-sm text-slate-600">
            {payload.validation.report.fixture_id} · {payload.validation.overall_status}
          </p>

          <div className="mt-4 grid gap-6 xl:grid-cols-2">
            <div>
              <h4 className="text-sm font-medium text-slate-900">Invariants</h4>
              <ul className="mt-3 space-y-2 text-sm text-slate-700">
                {payload.validation.report.invariant_results.map((result) => (
                  <li key={result.code} className="rounded-md border border-slate-200 px-3 py-2">
                    <span className="font-medium">{result.code}</span> · {result.status}
                    <div className="mt-1 text-slate-600">{result.message}</div>
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <h4 className="text-sm font-medium text-slate-900">Anchors</h4>
              <ul className="mt-3 space-y-2 text-sm text-slate-700">
                {payload.validation.report.anchor_results.length === 0 ? (
                  <li className="rounded-md border border-slate-200 px-3 py-2 text-slate-500">
                    No fixture-specific anchors for this run.
                  </li>
                ) : (
                  payload.validation.report.anchor_results.map((result) => (
                    <li key={result.anchor_id} className="rounded-md border border-slate-200 px-3 py-2">
                      <div className="font-medium">
                        {result.anchor_id} · {result.status}
                      </div>
                      <div className="mt-1 text-slate-600">
                        {result.verse_ref} · expected {result.expected_timestamp_sec ?? "—"} · actual{" "}
                        {result.actual_timestamp_sec ?? "—"}
                      </div>
                    </li>
                  ))
                )}
              </ul>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
