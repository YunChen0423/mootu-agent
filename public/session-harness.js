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
  ["core", EVENT_TYPES.ROBOT_UTTERANCE],
  ["[现场]", EVENT_TYPES.SCENE_EVENT],
  ["现场", EVENT_TYPES.SCENE_EVENT],
  ["[设备]", EVENT_TYPES.DEVICE_EVENT],
  ["设备", EVENT_TYPES.DEVICE_EVENT]
]);
const ICEBREAKER_SILENCE_TRIGGER_SECONDS = 18;

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

function keywordLabel(text) {
  const clean = String(text || "")
    .replace(/^(?:嗯|对|我觉得|我想到的是|我们可以|我们是不是|也许|或者|还有|那就|是不是|可以可以)[，,、\s]*/g, "")
    .replace(/(?:比较容易落地|不一定要|一直在围绕|完全不一样的|有没有|最好|可能|应该|其实)/g, "")
    .replace(/的形式|的方式|的方向|这个方案/g, "")
    .trim();
  const domainTerms = [...clean.matchAll(/[\u4e00-\u9fff]{0,6}(?:电话亭|小房间|空间|路线|地图|声音|音乐|任务|集章|游戏|装置|原型|互动|交互|拼合|组合)/g)]
    .map((match) => match[0].replace(/^(?:一个|一种|一条|可以是|像|做成|真正不同的)/, "").split("的").at(-1))
    .map((term) => term.replace(/^(?:单纯|收集|生成|合成|使用|通过)/, ""))
    .filter((term) => term.length >= 2 && term.length <= 8);
  if (domainTerms.length) return [...new Set(domainTerms)].slice(-2).join("＋").slice(0, 8);
  const clauses = clean.split(/[，,。！？；;：:]/).map((clause) => clause.trim()).filter((clause) => clause.length >= 2);
  const fallback = clauses.at(-1) || clean || "待归类";
  return fallback.replace(/^(?:可以是|可以做|先做|做一个|变成|就是)/, "").slice(0, 8);
}

function extractCandidates(events, time, synthesizedCandidates = []) {
  const visible = events.filter((event) => event.start <= time);
  const numberedCandidates = (text) => [...text.matchAll(/[一二三1-3](?:[、，,:：]|是)\s*([^；;。，,]+)/g)];
  const source = [...visible].reverse().find((event) => event.type === EVENT_TYPES.ROBOT_UTTERANCE && numberedCandidates(event.text).length >= 2);
  if (!source) {
    const synthesized = synthesizedCandidates.map((label) => String(label || "").trim()).filter((label) => label.length >= 2 && label.length <= 8).slice(0, 4);
    if (synthesized.length >= 2) return Object.freeze({
      version: 1,
      status: "ai_synthesized",
      items: Object.freeze(synthesized.map((label, index) => Object.freeze({ id: `ai-option-${index + 1}`, label, source: "deepseek" })))
    });
    const participantIdeas = visible.filter((event) => event.type === EVENT_TYPES.PARTICIPANT_UTTERANCE && event.text.length >= 8);
    const stableWindowEnd = Math.max(3, Math.floor(participantIdeas.length / 6) * 6);
    const stableIdeas = participantIdeas.slice(0, stableWindowEnd);
    const working = [...stableIdeas].reverse().filter((event, index, items) => {
      const label = keywordLabel(event.text);
      return items.findIndex((candidate) => keywordLabel(candidate.text) === label) === index;
    }).slice(0, 3).reverse();
    return Object.freeze({
      version: working.length ? Math.ceil(Math.min(participantIdeas.length, stableWindowEnd) / 6) : 0,
      status: working.length ? "evolving" : "empty",
      items: Object.freeze(working.map((event, index) => Object.freeze({ id: `working-${index + 1}`, label: keywordLabel(event.text), sourceEventId: event.id })))
    });
  }
  const matches = numberedCandidates(source.text);
  return Object.freeze({
    version: 1,
    status: "ready",
    sourceEventId: source.id,
    items: Object.freeze(matches.map((match, index) => Object.freeze({ id: `option-${index + 1}`, label: keywordLabel(match[1]) })))
  });
}

function buildBoundaries(events) {
  const participantEvents = events.filter((event) => event.type === EVENT_TYPES.PARTICIPANT_UTTERANCE);
  const firstParticipant = participantEvents[0]?.start ?? null;
  const explicitIcebreaker = findStart(events, (event) => includesAny(event.text, [/击鼓传花/, /接力/, /破冰/]));
  const silenceIcebreaker = firstParticipant != null && firstParticipant >= ICEBREAKER_SILENCE_TRIGGER_SECONDS ? ICEBREAKER_SILENCE_TRIGGER_SECONDS : null;
  const icebreaker = explicitIcebreaker == null ? silenceIcebreaker : silenceIcebreaker == null ? explicitIcebreaker : Math.min(explicitIcebreaker, silenceIcebreaker);
  const afterIcebreaker = icebreaker == null ? [] : participantEvents.filter((event) => event.start >= icebreaker);
  const discussion = icebreaker == null ? firstParticipant : (afterIcebreaker[1]?.start ?? afterIcebreaker[0]?.end ?? firstParticipant);
  const ballotPreparation = findStart(events, (event) => includesAny(event.text, [/讨论即将结束/, /整理.{0,6}(?:候选|方案)/, /三个(?:候选|选择|方案)/]));
  const fixedCandidateCue = findStart(events, (event) => /那我们整理三个候选吧[：:]?\s*一是感官集章[，,]\s*二是真实声音收集加\s*AI\s*合成[，,]\s*三是摊位角色秘密任务/.test(event.text));
  const workflowEvents = events.filter((event) => [EVENT_TYPES.ROBOT_UTTERANCE, EVENT_TYPES.DEVICE_EVENT].includes(event.type));
  const explicitVoting = findStart(workflowEvents, (event) => includesAny(event.text, [/请.{0,8}(?:pod|Pod)?.{0,6}投票/, /(?:用|使用|按).{0,8}(?:pod|Pod).{0,8}(?:独立)?投票/, /候选方案.{0,12}投票/, /显示.{0,8}(?:选项|方案)/, /(?:进入|切换到|开启|开始|发起)投票/, /投票(?:现在)?开始/, /按下.{0,8}(?:pod|Pod)/]));
  const spokenVoting = findStart(events, (event) => event.type === EVENT_TYPES.PARTICIPANT_UTTERANCE
    && !/[？?]|是不是|要不要/.test(event.text)
    && includesAny(event.text, [/我(?:先|要|准备)?投(?:票)?/, /(?:我们|大家)(?:现在|就|先)?(?:开始)?投票/, /(?:那就|现在|开始)(?:用.{0,6})?(?:投票|投一个|选一个)/]));
  const votingSignals = [fixedCandidateCue, explicitVoting, spokenVoting].filter((value) => value != null);
  const voting = votingSignals.length ? Math.min(...votingSignals) : null;
  const resultConfirmation = findStart(workflowEvents, (event) => includesAny(event.text, [/投票结束/, /公布.{0,6}结果/, /一致选择/, /最终选择/])) ;
  const closed = findStart(events, (event) => includesAny(event.text, [/讨论到这里结束/, /今天.{0,8}结束/, /本次.{0,8}结束/, /会话结束/]));
  return Object.freeze({ icebreaker, discussion, ballotPreparation, voting, resultConfirmation, closed });
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
  if (phase === SESSION_PHASES.BALLOT_PREPARATION) return { activeAgent: "discussion_facilitator", activeWorkflow: null };
  if ([SESSION_PHASES.VOTING, SESSION_PHASES.RESULT_CONFIRMATION].includes(phase)) return { activeAgent: "router", activeWorkflow: "voting" };
  return { activeAgent: "router", activeWorkflow: null };
}

const CHINESE_NUMBERS = Object.freeze({ "一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9, "十": 10 });

function optionFromText(text, candidates) {
  const value = String(text || "");
  const direct = candidates.find((candidate) => value.includes(candidate.label));
  if (direct) return direct;
  const canonical = (input) => String(input || "")
    .replace(/\s|AI|人工智能/gi, "")
    .replace(/收集(?:加|后)?组合/g, "收集组合")
    .replace(/真实(?:的)?声音/g, "真实声音")
    .replace(/摊位角色(?:之间)?的?/g, "摊位角色");
  const normalizedValue = canonical(value);
  const semantic = candidates.find((candidate) => {
    const label = canonical(candidate.label);
    return label.length >= 3 && normalizedValue.includes(label);
  });
  if (semantic) return semantic;
  const ordinalMatch = value.match(/(?:方案|选项|第)\s*([一二三四1-4A-D])(?:个|项)?|(?:投|选|支持)\s*([A-D])(?:方案|选项)?/i);
  const ordinal = ordinalMatch?.[1] || ordinalMatch?.[2];
  if (!ordinal) return null;
  const index = /[A-D]/i.test(ordinal) ? ordinal.toUpperCase().charCodeAt(0) - 64 : Number(ordinal) || CHINESE_NUMBERS[ordinal];
  return candidates[index - 1] || null;
}

function parseVoteLedger(events, time, candidates = [], participants = []) {
  const visible = events.filter((event) => event.start <= time);
  const participantIds = new Set(participants.map((participant) => String(participant.id)));
  const byParticipant = new Map();
  const sourceEvents = [];
  let declaredWinner = null;
  let declaredCount = 0;
  for (const event of visible) {
    const isVoteText = /投票|投给|我(?:先|要|准备)?投|支持|选择|选项|方案.{0,3}(?:一|二|三|四|[A-D1-4])|按下|结果|胜出|一致/.test(event.text);
    if (!isVoteText) continue;
    const option = optionFromText(event.text, candidates);
    if (event.type === EVENT_TYPES.PARTICIPANT_UTTERANCE && participantIds.has(event.speaker) && option && /投|支持|选择|倾向|就选/.test(event.text)) {
      byParticipant.set(event.speaker, Object.freeze({ participantId: event.speaker, candidateId: option.id, label: option.label, eventId: event.id }));
      sourceEvents.push(event);
    }
    if ([EVENT_TYPES.DEVICE_EVENT, EVENT_TYPES.ROBOT_UTTERANCE].includes(event.type)) {
      if (option && /按下|投票|选择/.test(event.text)) {
        const participantList = event.text.match(/([A-Za-z0-9](?:\s*[、，,]\s*[A-Za-z0-9])+).{0,6}(?:依次|分别|都|全员|按下)/)?.[1] || "";
        const listedParticipants = participantList.match(/[A-Za-z0-9]/g) || [];
        for (const participantId of listedParticipants) {
          if (participantIds.has(participantId)) byParticipant.set(participantId, Object.freeze({ participantId, candidateId: option.id, label: option.label, eventId: event.id }));
        }
      }
      for (const match of event.text.matchAll(/([A-Za-z0-9])\s*(?:选择|投给|投了?|按下)\s*([^，。；;]+)/g)) {
        const selected = optionFromText(match[2], candidates);
        if (participantIds.has(match[1]) && selected) byParticipant.set(match[1], Object.freeze({ participantId: match[1], candidateId: selected.id, label: selected.label, eventId: event.id }));
      }
      const countMatch = event.text.match(/([一二三四五六七八九十\d]+)票.{0,5}(?:支持|选择|投给|胜出)\s*([^，。；;]+)/);
      const resultOption = optionFromText(countMatch?.[2] || event.text, candidates);
      if (resultOption && /投票结束|结果|胜出|一致|\d+票|[一二三四五六七八九十]票/.test(event.text)) {
        declaredWinner = resultOption;
        declaredCount = Number(countMatch?.[1]) || CHINESE_NUMBERS[countMatch?.[1]] || (/一致/.test(event.text) ? participants.length : 0);
      }
      sourceEvents.push(event);
    }
  }
  const records = [...byParticipant.values()];
  const tallies = candidates.map((candidate) => Object.freeze({
    candidateId: candidate.id,
    label: candidate.label,
    count: records.filter((record) => record.candidateId === candidate.id).length + (declaredWinner?.id === candidate.id && !records.length ? declaredCount : 0)
  }));
  const winner = declaredWinner || [...tallies].sort((a, b) => b.count - a.count)[0];
  return Object.freeze({
    status: sourceEvents.length ? (/投票结束|结果|胜出|一致/.test(sourceEvents.at(-1)?.text || "") ? "complete" : "collecting") : "empty",
    records: Object.freeze(records),
    tallies: Object.freeze(tallies),
    winner: winner?.count || declaredWinner ? Object.freeze({ candidateId: winner.candidateId || winner.id, label: winner.label, count: Math.max(winner.count || 0, declaredCount) }) : null,
    sourceEvents: Object.freeze(sourceEvents.map((event) => Object.freeze({ eventId: event.id, text: event.text })))
  });
}

export class SessionHarness {
  constructor({ transcript = [], participants = [], candidateIdeas = [] } = {}) {
    this.eventLog = Object.freeze(annotateTranscript(transcript));
    const detected = participantSpeakers(this.eventLog);
    const supplied = new Map(participants.map((participant) => [participant.id, participant]));
    this.participants = Object.freeze(detected.map((id) => Object.freeze(supplied.get(id) || { id, name: id })));
    this.boundaries = buildBoundaries(this.eventLog);
    this.candidateIdeas = Object.freeze([...candidateIdeas]);
    this.transitionHistory = [];
    this.votingCandidates = null;
    this.blackboard = Object.freeze({});
    this.setTime(0, "diverge");
  }

  setTime(time, discussionStage = "diverge") {
    const safeTime = Math.max(0, Number(time) || 0);
    const phase = phaseAt(this.boundaries, safeTime);
    const previousPhase = this.blackboard.phase;
    if (previousPhase && previousPhase !== phase) this.transitionHistory.push(Object.freeze({ from: previousPhase, to: phase, at: safeTime }));
    const currentEvent = [...this.eventLog].reverse().find((event) => event.start <= safeTime) || null;
    const ballotLightsReady = this.eventLog.some((event) => event.start <= safeTime
      && event.type === EVENT_TYPES.PARTICIPANT_UTTERANCE
      && /我选好了/.test(event.text));
    const owner = ownerForPhase(phase);
    const liveCandidates = extractCandidates(this.eventLog, safeTime, this.candidateIdeas);
    const hasEnteredVoting = [SESSION_PHASES.VOTING, SESSION_PHASES.RESULT_CONFIRMATION, SESSION_PHASES.CLOSED].includes(phase);
    const candidateSnapshotReady = ["ready", "ai_synthesized"].includes(liveCandidates.status);
    if (hasEnteredVoting && !this.votingCandidates && candidateSnapshotReady) this.votingCandidates = liveCandidates;
    const candidates = hasEnteredVoting
      ? this.votingCandidates || Object.freeze({ version: 0, status: "pending_ai", items: Object.freeze([]) })
      : liveCandidates;
    this.blackboard = Object.freeze({
      sessionTime: safeTime,
      phase,
      discussionStage: phase === SESSION_PHASES.DISCUSSION ? discussionStage : phase === SESSION_PHASES.BALLOT_PREPARATION ? "converge" : null,
      ...owner,
      coactiveAgents: Object.freeze([SESSION_PHASES.DISCUSSION, SESSION_PHASES.BALLOT_PREPARATION].includes(phase)
        ? ["discussion_facilitator", "candidate_synthesis"]
        : [owner.activeAgent]),
      participants: this.participants,
      podMap: Object.freeze(this.participants.map((participant, index) => Object.freeze({ participantId: participant.id, podId: `pod-${index + 1}` }))),
      currentEvent,
      ballotLightsReady,
      candidates,
      voteLedger: parseVoteLedger(this.eventLog, safeTime, candidates.items, this.participants),
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
