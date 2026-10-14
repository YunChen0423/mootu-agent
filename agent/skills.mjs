const SKILLS = Object.freeze([
  Object.freeze({ id: "phase-routing", version: "1.0.0", phases: ["waiting", "discussion", "ballot_preparation", "voting", "result_confirmation"], tools: ["read_blackboard", "propose_transition"] }),
  Object.freeze({ id: "icebreaker-protocol", version: "1.0.0", phases: ["icebreaker"], tools: ["run_icebreaker_workflow"] }),
  Object.freeze({ id: "discussion-facilitation", version: "1.0.0", phases: ["discussion"], tools: ["observe_discussion_window", "evaluate_candidates", "dispatch_intervention"] }),
  Object.freeze({ id: "candidate-synthesis", version: "1.0.0", phases: ["ballot_preparation"], tools: ["read_discussion_summary", "write_candidate_snapshot"] }),
  Object.freeze({ id: "voting-protocol", version: "1.0.0", phases: ["voting", "result_confirmation"], tools: ["run_voting_workflow"] })
]);

export function discoverSkills({ phase, allowedTools = [] }) {
  return SKILLS.filter((skill) => skill.phases.includes(phase)).map((skill) => ({ ...skill, tools: skill.tools.filter((tool) => !allowedTools.length || allowedTools.includes(tool)) }));
}

export const skillRegistry = SKILLS;
