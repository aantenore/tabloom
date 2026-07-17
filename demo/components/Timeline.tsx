import type { BrokerEvent } from '@tabloom';
import { ClockIcon } from '../icons.js';

interface TimelineProps {
  readonly events: readonly BrokerEvent[];
  readonly onClear: () => void;
}

export function Timeline({ events, onClear }: TimelineProps) {
  return (
    <section className="timeline" aria-labelledby="timeline-title">
      <header className="timeline-header">
        <div className="section-title">
          <ClockIcon />
          <h2 id="timeline-title">Event timeline</h2>
        </div>
        <div className="timeline-meta">
          <span>
            <span className="status-dot" /> live
          </span>
          <button onClick={onClear}>Clear</button>
        </div>
      </header>
      <div
        className="timeline-table"
        role="region"
        aria-label="Safe broker events"
      >
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>Type</th>
              <th>Request</th>
              <th>Source</th>
              <th>Epoch</th>
              <th>Attempt</th>
              <th>Queue</th>
            </tr>
          </thead>
          <tbody>
            {events.length === 0 ? (
              <tr>
                <td colSpan={7} className="empty-row">
                  Waiting for coordination events.
                </td>
              </tr>
            ) : (
              events.map((event, index) => (
                <tr key={`${event.at}-${event.type}-${index}`}>
                  <td>{formatTime(event.at)}</td>
                  <td>
                    <span className={`event-type event-${event.type}`}>
                      {event.type}
                    </span>
                  </td>
                  <td>{shortId(event.requestId)}</td>
                  <td>{shortId(event.sourceId)}</td>
                  <td>{event.epoch ?? '—'}</td>
                  <td>{event.attempt ?? '—'}</td>
                  <td>{event.queueDepth ?? '—'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function formatTime(at: number): string {
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    fractionalSecondDigits: 3,
    hour12: false,
  }).format(at);
}

function shortId(id?: string): string {
  if (id === undefined) {
    return '—';
  }
  return id.length > 9 ? `${id.slice(0, 7)}…` : id;
}
