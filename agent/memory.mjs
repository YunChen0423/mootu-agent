export function compressWorkingMemory({ observations = [], decisions = [], maxObservations = 8 } = {}) {
  return Object.freeze({
    recentObservations: Object.freeze(observations.slice(-maxObservations)),
    lastDecision: decisions.at(-1) || null,
    openQuestions: Object.freeze(decisions.at(-1)?.missingEvidence || []),
    compressedAt: new Date().toISOString()
  });
}

export function createAgentMemoryView(harness, agentId) {
  return Object.freeze({
    scope: agentId,
    session: harness.getAgentView(agentId),
    local: compressWorkingMemory()
  });
}
