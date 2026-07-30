/**
 * Pure ZDR provider-selection filter. Given a list of route candidates and
 * whether ZDR is effectively active for the request, returns only the
 * candidates whose provider has been explicitly flagged ZDR-capable.
 *
 * Kept dependency-free (no DB/config imports) so it can be unit-tested in
 * isolation and safely composed into the routing candidate list right before
 * the failover loop, without touching the routing/failover algorithm itself.
 */

export interface ZdrRoutableCandidate {
  channelName: string;
}

export interface ZdrProviderCapability {
  channelName: string;
  zdrCapable: boolean;
}

export function filterCandidatesForZdr<T extends ZdrRoutableCandidate>(
  candidates: T[],
  zdrActive: boolean,
  capabilities: ZdrProviderCapability[],
): T[] {
  if (!zdrActive) return candidates;

  const capableChannels = new Set(
    capabilities.filter((capability) => capability.zdrCapable).map((capability) => capability.channelName),
  );
  return candidates.filter((candidate) => capableChannels.has(candidate.channelName));
}
