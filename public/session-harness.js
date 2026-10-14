export const SESSION_PHASES = Object.freeze({
  WAITING: "waiting",
  ICEBREAKER: "icebreaker",
  DISCUSSION: "discussion",
  BALLOT_PREPARATION: "ballot_preparation",
  VOTING: "voting",
  RESULT_CONFIRMATION: "result_confirmation",
  CLOSED: "closed"
});

export const EVENT_TYPES = Object.freeze({
  PARTICIPANT_UTTERANCE: "participant_utterance",
  ROBOT_UTTERANCE: "robot_utterance",
  SCENE_EVENT: "scene_event",
  DEVICE_EVENT: "device_event"
});

const SYSTEM_SPEAKERS = new Map([
  ["mootu", EVENT_TYPES.ROBOT_UTTERANCE],
  ["[现场]", EVENT_TYPES.SCENE_EVENT],
  ["现场", EVENT_TYPES.SCENE_EVENT],
  ["[设备]", EVENT_TYPES.DEVICE_EVENT],
  ["设备", EVENT_TYPES.DEVICE_EVENT]
]);

const normalizeSpeakerKey = (speaker) => String(speaker || "").trim().toLowerCase();

export function classifyTranscriptLine(line) {
  return SYSTEM_SPEAKERS.get(normalizeSpeakerKey(line?.speaker)) || EVENT_TYPES.PARTICIPANT_UTTERANCE;
}

export function annotateTranscript(lines = []) {
  return lines.map((line, index) => Object.freeze({
    id: String(line.id || `evt-${String(index + 1).padStart(4, "0")}`),
    start: Number(line.start),
    end: Number(line.end),
    speaker: String(line.speaker).trim(),
    text: String(line.text).trim(),
    type: line.type || classifyTranscriptLine(line)
  }));
}

export function participantSpeakers(lines = []) {
  return [...new Set(lines.filter((line) => (line.type || classifyTranscriptLine(line)) === EVENT_TYPES.PARTICIPANT_UTTERANCE).map((line) => line.speaker))];
}

const includesAny = (text, expressions) => expressions.some((expression) => expression.test(text));

function findStart(events, predicate) {
  return events.find(predicate)?.start ?? null;
}

function extractCandidates(events) {
  const source = events.find((event) => event.type === EVENT_TYPES.ROBOT_UTTERANCE && /三个|候选|选择|方案/.test(event.text) && /一[、，,:：]|二[、，,:：]|三[、，,:：]/.test(event.text));
  if (!source) return Object.freeze({ version: 0, status: "empty", items: [] });
  const matches = [...source.text.matchAll(/[一二三1-3][、，,:：]\s*([^；;。]+)/g)];
  return Object.freeze({
    version: 1,
    status: "ready",
    sourceEventId: source.id,
    items: Object.freeze(matches.map((match, index) => Object.freeze({ id: `option-${index + 1}`, label: match[1].trim() })))
  });
}

function buildBoundaries(events) {
  const icebreaker = findStart(events, (event) => includesAny(event.text, [/击鼓传花/, /接力/, /破冰/]));
  const firstParticipant = findStart(events, (event) => event.type === EVENT_TYPES.PARTICIPANT_UTTERANCE && (icebreaker == null || event.start >= icebreaker));
  const ballotPreparation = findStart(events, (event) => includesAny(event.text, [/讨论即将结束/, /整理.{0,6}(?:候选|方案)/, /三个(?:候选|选择|方案)/]));
  const voting = findStart(events, (event) => includesAny(event.text, [/请.{0,8}(?:pod|Pod).{0,6}投票/, /显示.{0,8}(?:选项|方案)/, /开始投票/, /按下.{0,8}(?:pod|Pod)/]));
  const resultConfirmation = findStart(events, (event) => includesAny(event.text, [/投票结束/, /公布.{0,6}结果/, /一致选择/, /最终选择/])) ;
  const closed = findStart(events, (event) => includesAny(event.text, [/讨论到这里结束/, /今天.{0,8}结束/, /本次.{0,8}结束/, /会话结束/]));
  return Object.freeze({ icebreaker, discussion: firstParticipant, ballotPreparation, voting, resultConfirmation, closed });
}

function phaseAt(boundaries, time) {
  if (boundaries.closed != null && time >= boundaries.closed) return SESSION_PHASES.CLOSED;
  if (boundaries.resultConfirmation != null && time >= boundaries.resultConfirmation) return SESSION_PHASES.RESULT_CONFIRMATION;
  if (boundaries.voting != null && time >= boundaries.voting) return SESSION_PHASES.VOTING;
  if (boundaries.ballotPreparation != null && time >= boundaries.ballotPreparation) return SESSION_PHASES.BALLOT_PREPARATION;
  if (boundaries.discussion != null && time >= boundaries.discussion) return SESSION_PHASES.DISCUSSION;
  if (boundaries.icebreaker != null && time >= boundaries.icebreaker) return SESSION_PHASES.ICEBREAKER;
  return SESSION_PHASES.WAITING;
}

function ownerForPhase(phase) {
  if (phase === SESSION_PHASES.ICEBREAKER) return { activeAgent: "router", activeWorkflow: "icebreaker" };
  if (phase === SESSION_PHASES.DISCUSSION) return { activeAgent: "discussion_facilitator", activeWorkflow: null };
  if (phase === SESSION_PHASES.BALLOT_PREPARATION) return { activeAgent: "candidate_synthesis", activeWorkflow: null };
  if ([SESSION_PHASES.VOTING, SESSION_PHASES.RESULT_CONFIRMATION].includes(phase)) return { activeAgent: "router", activeWorkflow: "voting" };
  return { activeAgent: "router", activeWorkflow: null };
}

function parseVoteLedger(events, time) {
  const records = events.filter((event) => event.start <= time && event.type === EVENT_TYPES.DEVICE_EVENT && /投票|选择|按下|结果/.test(event.text));
  return Object.freeze({ status: records.length ? "collecting" : "empty", records: Object.freeze(records.map((event) => Object.freeze({ eventId: event.id, text: event.text }))) });
}

export class SessionHarness {
  constructor({ transcript = [], participants = [] } = {}) {
    this.eventLog = Object.freeze(annotateTranscript(transcript));
    const detected = participantSpeakers(this.eventLog);
    const supplied = new Map(participants.map((participant) => [participant.id, participant]));
    this.participants = Object.freeze(detected.map((id) => Object.freeze(supplied.get(id) || { id, name: id })));
    this.boundaries = buildBoundaries(this.eventLog);
    this.candidates = extractCandidates(this.eventLog);
    this.transitionHistory = [];
    this.blackboard = Object.freeze({});
    this.setTime(0, "diverge");
  }

  setTime(time, discussionStage = "diverge") {
    const safeTime = Math.max(0, Number(time) || 0);
    const phase = phaseAt(this.boundaries, safeTime);
    const previousPhase = this.blackboard.phase;
    if (previousPhase && previousPhase !== phase) this.transitionHistory.push(Object.freeze({ from: previousPhase, to: phase, at: safeTime }));
    const currentEvent = [...this.eventLog].reverse().find((event) => event.start <= safeTime) || null;
    const owner = ownerForPhase(phase);
    this.blackboard = Object.freeze({
      sessionTime: safeTime,
      phase,
      discussionStage: phase === SESSION_PHASES.DISCUSSION ? discussionStage : null,
      ...owner,
      participants: this.participants,
      podMap: Object.freeze(this.participants.map((participant, index) => Object.freeze({ participantId: participant.id, podId: `pod-${index + 1}` }))),
      currentEvent,
      candidates: this.candidates,
      voteLedger: parseVoteLedger(this.eventLog, safeTime),
      transitionHistory: Object.freeze([...this.transitionHistory])
    });
    return this.blackboard;
  }

  getAgentView(agent) {
    const shared = { phase: this.blackboard.phase, sessionTime: this.blackboard.sessionTime, participants: this.participants, currentEvent: this.blackboard.currentEvent };
    if (agent === "discussion_facilitator") return Object.freeze({ ...shared, discussionStage: this.blackboard.discussionStage, recentUtterances: this.eventLog.filter((event) => event.type === EVENT_TYPES.PARTICIPANT_UTTERANCE && event.start <= this.blackboard.sessionTime).slice(-8) });
    if (agent === "candidate_synthesis") return Object.freeze({ ...shared, candidates: this.blackboard.candidates, recentUtterances: this.eventLog.filter((event) => event.type === EVENT_TYPES.PARTICIPANT_UTTERANCE && event.start <= this.blackboard.sessionTime).slice(-20) });
    return Object.freeze({ ...shared, boundaries: this.boundaries, activeWorkflow: this.blackboard.activeWorkflow, transitionHistory: this.blackboard.transitionHistory });
  }
}

export const createSessionHarness = (options) => new SessionHarness(options);
