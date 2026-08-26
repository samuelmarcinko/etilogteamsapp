import { AlertTriangle, CalendarRange, Lock, RefreshCw } from 'lucide-react';

/**
 * Loading, empty, error and no-access states.
 *
 * The skeleton mirrors the real grid - week header, shift rows, notes row - so
 * the layout does not jump when data lands.
 */

export function WeekSkeleton({ weeks = 4 }) {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading production plan">
      {Array.from({ length: weeks }).map((_, w) => (
        <div key={w} className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
          <div className="flex items-center gap-2 border-b border-gray-200 bg-gray-25 px-4 py-2.5">
            <div className="h-3 w-16 animate-pulse rounded bg-gray-200" />
            <div className="h-3 w-32 animate-pulse rounded bg-gray-100" />
          </div>
          <div className="week-grid">
            <div className="row-label" />
            {Array.from({ length: 7 }).map((_, d) => (
              <div key={d} className="week-cell px-2 py-2">
                <div className="mx-auto h-3 w-10 animate-pulse rounded bg-gray-100" />
              </div>
            ))}
            {['Morning', 'Afternoon'].map((label) => (
              <Row key={label} label={label}>
                {Array.from({ length: 7 }).map((_, d) => (
                  <div key={d} className="week-cell min-h-[56px] p-1">
                    {(w + d) % 3 === 0 && (
                      <div
                        className="h-11 animate-pulse rounded-md bg-gray-100"
                        style={{ animationDelay: `${(w * 7 + d) * 40}ms` }}
                      />
                    )}
                  </div>
                ))}
              </Row>
            ))}
            <Row label="Notes">
              {Array.from({ length: 7 }).map((_, d) => (
                <div key={d} className="week-cell min-h-[30px] bg-gray-25" />
              ))}
            </Row>
          </div>
        </div>
      ))}
    </div>
  );
}

function Row({ label, children }) {
  return (
    <>
      <div className="row-label flex items-center">{label}</div>
      {children}
    </>
  );
}

function Panel({ icon: Icon, tone = 'neutral', title, children, action }) {
  const tones = {
    neutral: 'text-gray-400',
    danger: 'text-etilog'
  };

  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-gray-300 bg-white px-6 py-14 text-center">
      <Icon className={`h-8 w-8 ${tones[tone]}`} strokeWidth={1.5} aria-hidden="true" />
      <h2 className="text-[15px] font-semibold text-gray-900">{title}</h2>
      <div className="max-w-md text-[13px] leading-relaxed text-gray-500">{children}</div>
      {action}
    </div>
  );
}

export function EmptyWeeks({ locationName }) {
  return (
    <Panel icon={CalendarRange} title="Nothing planned yet">
      No production is scheduled for {locationName} in these weeks. Move to another range, or import
      the history from the Excel workbook to fill the plan.
    </Panel>
  );
}

export function ErrorState({ error, onRetry }) {
  return (
    <Panel
      icon={AlertTriangle}
      tone="danger"
      title="Could not load the plan"
      action={
        onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex items-center gap-1.5 rounded-md bg-etilog px-3 py-1.5 text-[13px] font-medium text-white transition hover:bg-etilog-hover"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            Try again
          </button>
        )
      }
    >
      {error?.message || 'Something went wrong while talking to the server.'}
    </Panel>
  );
}

export function NoAccess() {
  return (
    <Panel icon={Lock} title="No access to the production plan">
      Your role does not include production plan access. An administrator can grant it in the portal
      under employee administration.
      <div className="mt-4">
        <a
          href="/portal/"
          className="inline-flex rounded-md border border-gray-300 bg-white px-3 py-1.5 text-[13px] font-medium text-gray-700 transition hover:bg-gray-50"
        >
          Back to portal
        </a>
      </div>
    </Panel>
  );
}
