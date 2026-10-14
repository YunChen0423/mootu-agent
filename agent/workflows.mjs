export const WORKFLOW_MANIFESTS = Object.freeze({
  icebreaker: Object.freeze({
    version: "1.0.0",
    owner: "session_router",
    steps: ["announce", "start_relay", "select_participant", "wait_for_valid_utterance", "complete"],
    timeoutPolicy: "retry_once_then_skip"
  }),
  voting: Object.freeze({
    version: "1.0.0",
    owner: "session_router",
    steps: ["freeze_candidate_version", "present_options", "open_pods", "collect_votes", "validate_quorum", "publish_result"],
    tiePolicy: "return_to_ballot_preparation"
  })
});

export function createWorkflow(name, context = {}) {
  const manifest = WORKFLOW_MANIFESTS[name];
  if (!manifest) throw new Error(`未知 workflow: ${name}`);
  let stepIndex = 0;
  return {
    manifest,
    context: structuredClone(context),
    get state() { return manifest.steps[stepIndex]; },
    advance(evidence = {}) {
      if (stepIndex < manifest.steps.length - 1) stepIndex += 1;
      return { workflow: name, state: manifest.steps[stepIndex], evidence };
    }
  };
}
