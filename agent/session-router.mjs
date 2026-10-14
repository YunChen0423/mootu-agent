import { SESSION_PHASES } from "../public/session-harness.js";

export const PHASE_GRAPH = Object.freeze({
  [SESSION_PHASES.WAITING]: [SESSION_PHASES.ICEBREAKER, SESSION_PHASES.DISCUSSION],
  [SESSION_PHASES.ICEBREAKER]: [SESSION_PHASES.DISCUSSION],
  [SESSION_PHASES.DISCUSSION]: [SESSION_PHASES.BALLOT_PREPARATION],
  [SESSION_PHASES.BALLOT_PREPARATION]: [SESSION_PHASES.DISCUSSION, SESSION_PHASES.VOTING],
  [SESSION_PHASES.VOTING]: [SESSION_PHASES.BALLOT_PREPARATION, SESSION_PHASES.RESULT_CONFIRMATION],
  [SESSION_PHASES.RESULT_CONFIRMATION]: [SESSION_PHASES.VOTING, SESSION_PHASES.CLOSED],
  [SESSION_PHASES.CLOSED]: []
});

export function validateTransition({ from, to, blackboard }) {
  if (from === to) return { allowed: true, reason: "阶段未变化" };
  if (!PHASE_GRAPH[from]?.includes(to)) return { allowed: false, reason: `不允许从 ${from} 直接切换到 ${to}` };
  if (to === SESSION_PHASES.VOTING && !blackboard?.candidates?.items?.length) return { allowed: false, reason: "候选方案尚未形成" };
  if (to === SESSION_PHASES.RESULT_CONFIRMATION && !blackboard?.voteLedger?.records?.length) return { allowed: false, reason: "尚未收到有效投票事件" };
  return { allowed: true, reason: "满足阶段切换守卫" };
}

export function proposeTransition({ blackboard, signal }) {
  const from = blackboard.phase;
  let to = from;
  if (from === SESSION_PHASES.DISCUSSION && signal?.discussionComplete) to = SESSION_PHASES.BALLOT_PREPARATION;
  if (from === SESSION_PHASES.BALLOT_PREPARATION && signal?.candidatesReady) to = SESSION_PHASES.VOTING;
  if (from === SESSION_PHASES.VOTING && signal?.votesComplete) to = SESSION_PHASES.RESULT_CONFIRMATION;
  if (from === SESSION_PHASES.RESULT_CONFIRMATION && signal?.consensusConfirmed) to = SESSION_PHASES.CLOSED;
  return { from, to, ...validateTransition({ from, to, blackboard }) };
}
