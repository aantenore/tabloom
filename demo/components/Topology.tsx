import type { BrokerSnapshot } from '@tabloom';
import { LoomMark, TabIcon, TopologyIcon } from '../icons.js';

interface TopologyProps {
  readonly snapshot: BrokerSnapshot;
}

interface NodeView {
  readonly id: string;
  readonly isLocal: boolean;
  readonly isOwner: boolean;
  readonly label: string;
}

export function Topology({ snapshot }: TopologyProps) {
  const ownerId =
    snapshot.role === 'leader' ? snapshot.tabId : snapshot.leaderId;
  const ids = [
    snapshot.tabId,
    ...snapshot.knownPeers.map((peer) => peer.id),
  ].filter((id, index, all) => all.indexOf(id) === index);
  const peers = ids.filter((id) => id !== ownerId);
  const orderedIds = ownerId === undefined ? ids : [ownerId, ...peers];
  const nodes: NodeView[] = orderedIds.slice(0, 3).map((id, index) => ({
    id,
    isLocal: id === snapshot.tabId,
    isOwner: id === ownerId,
    label:
      id === ownerId
        ? 'Owner'
        : `Peer ${String.fromCharCode(64 + Math.max(1, index))}`,
  }));

  return (
    <section className="topology" aria-labelledby="topology-title">
      <header className="section-header">
        <div className="section-title">
          <TopologyIcon />
          <h2 id="topology-title">Topology</h2>
        </div>
        <span className="connection-status">
          <span className="status-dot" /> Connected ({nodes.length}{' '}
          {nodes.length === 1 ? 'tab' : 'tabs'})
        </span>
        <span className="simulation-label">Deterministic simulation</span>
      </header>

      <div className="topology-stage">
        <div className="connector-lines" aria-hidden="true">
          <span className="connector owner-line" />
          <span className="connector peer-a-line" />
          <span className="connector peer-b-line" />
          <div className="loom-core">
            <LoomMark />
          </div>
        </div>
        {nodes.map((node, index) => (
          <NodeCard
            key={node.id}
            node={node}
            index={index}
            epoch={snapshot.epoch}
            queueDepth={node.isOwner ? snapshot.queueDepth : 0}
            capacity={snapshot.config.queueCapacity}
          />
        ))}
        {nodes.length < 3
          ? Array.from({ length: 3 - nodes.length }, (_, offset) => (
              <div
                className={`node-card placeholder node-${nodes.length + offset}`}
                key={`placeholder-${offset}`}
              >
                <span>Waiting for peer</span>
              </div>
            ))
          : null}
      </div>
    </section>
  );
}

interface NodeCardProps {
  readonly capacity: number;
  readonly epoch: number;
  readonly index: number;
  readonly node: NodeView;
  readonly queueDepth: number;
}

function NodeCard({ capacity, epoch, index, node, queueDepth }: NodeCardProps) {
  const displayId = shortId(node.id);
  return (
    <article
      className={`node-card node-${index} ${node.isOwner ? 'owner' : 'peer'}`}
      data-testid="topology-node"
      data-node-role={node.isOwner ? 'leader' : 'peer'}
    >
      <div className="node-heading">
        <TabIcon />
        <strong>{displayId}</strong>
        {node.isLocal ? <span className="local-flag">this tab</span> : null}
      </div>
      <div className="node-role">{node.label}</div>
      <dl>
        <div>
          <dt>Epoch</dt>
          <dd>{epoch}</dd>
        </div>
        <div>
          <dt>Queue</dt>
          <dd>
            {queueDepth} / {capacity}
          </dd>
        </div>
      </dl>
      <div className="queue-meter" aria-hidden="true">
        {Array.from({ length: Math.min(capacity, 8) }, (_, slot) => (
          <span className={slot < queueDepth ? 'filled' : ''} key={slot} />
        ))}
      </div>
      <div className="heartbeat">
        <span className="status-dot" /> live lease
      </div>
    </article>
  );
}

function shortId(id: string): string {
  return id.length > 11 ? `${id.slice(0, 8)}…` : id;
}
