"""Drive the sibling Mootu MuJoCo model from the Agent Lab web output.

The browser connects to ws://127.0.0.1:8765 and sends versioned
``mootu.command`` messages.  The socket is loopback-only; no cloud service can
directly control the simulator.
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass
import json
import math
from pathlib import Path
import sys
import threading
import time
from typing import Any


PROJECT_ROOT = Path(__file__).resolve().parents[1]
MOOTU_ROOT = next(
    candidate
    for candidate in (PROJECT_ROOT.parent / "mootu", PROJECT_ROOT.parent.parent / "mootu")
    if (candidate / "interaction_demo.xml").is_file()
)
sys.path.insert(0, str(MOOTU_ROOT))

from mootu.controller import (  # noqa: E402
    ArticulationTargets,
    WheelSpeeds,
    apply_articulation_targets,
    apply_wheel_speeds,
    halt_base_motion,
)
from mootu.model import load_model  # noqa: E402


DEFAULT_MODEL = MOOTU_ROOT / "interaction_demo.xml"
STRATEGIES = {
    "observe",
    "invite_quiet_member",
    "open_new_direction",
    "sustain_flow",
    "prepare_convergence",
    "advance_decision",
}
POD_GEOMS = tuple(f"pod_{index}_light" for index in range(1, 7))


@dataclass(frozen=True)
class Command:
    sequence: int
    strategy: str
    target: str | None
    stage: str
    utterance: str
    received_at: float


class CommandState:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._command = Command(0, "observe", None, "diverge", "", time.monotonic())

    def update(self, command: Command) -> bool:
        with self._lock:
            self._command = command
            return True

    def read(self) -> Command:
        with self._lock:
            return self._command


def parse_command(raw: str) -> Command:
    payload = json.loads(raw)
    if payload.get("type") != "mootu.command" or payload.get("version") != 1:
        raise ValueError("unsupported command envelope")
    strategy = str(payload.get("strategy", ""))
    if strategy not in STRATEGIES:
        raise ValueError(f"unsupported strategy: {strategy}")
    sequence = int(payload.get("sequence", 0))
    if sequence < 1:
        raise ValueError("sequence must be a positive integer")
    target = payload.get("target")
    core = payload.get("core") if isinstance(payload.get("core"), dict) else {}
    return Command(
        sequence=sequence,
        strategy=strategy,
        target=str(target)[:32] if target is not None else None,
        stage=str(payload.get("stage", "diverge"))[:16],
        utterance=str(core.get("display", ""))[:160],
        received_at=time.monotonic(),
    )


def target_pod(target: str | None) -> str | None:
    if not target:
        return None
    label = target.strip().upper()
    if len(label) == 1 and "A" <= label <= "F":
        return POD_GEOMS[ord(label) - ord("A")]
    if label.isdigit() and 1 <= int(label) <= len(POD_GEOMS):
        return POD_GEOMS[int(label) - 1]
    return None


def wrap_angle(angle: float) -> float:
    return (angle + math.pi) % (2.0 * math.pi) - math.pi


def base_yaw(data: Any) -> float:
    w, x, y, z = (float(value) for value in data.joint("robot_freejoint").qpos[3:7])
    return math.atan2(2.0 * (w * z + x * y), 1.0 - 2.0 * (y * y + z * z))


def yaw_to_geom(data: Any, geom_name: str) -> float:
    robot_xy = data.body("robot").xpos[:2]
    target_xy = data.geom(geom_name).xpos[:2]
    dx, dy = (float(value) for value in target_xy - robot_xy)
    return math.atan2(-dx, dy)


def controls_for(model: Any, data: Any, command: Command, now: float) -> tuple[WheelSpeeds, ArticulationTargets]:
    elapsed = now - command.received_at
    target_geom = target_pod(command.target)
    target_error = None
    if target_geom:
        target_error = wrap_angle(yaw_to_geom(data, target_geom) - base_yaw(data))

    if command.strategy == "observe":
        return WheelSpeeds.stopped(), ArticulationTargets(head_yaw=math.radians(9) * math.sin(now * 0.55))

    if command.strategy == "invite_quiet_member":
        error = target_error if target_error is not None else 0.0
        aligned = abs(error) < math.radians(3)
        angular = 0.0 if aligned else max(-5.0, min(5.0, error * 4.5))
        linear = 0.004 if aligned and elapsed < 0.9 else 0.0
        return (
            WheelSpeeds.from_twist(linear, angular),
            ArticulationTargets(neck_pitch=math.radians(9), head_pitch=math.radians(5), head_yaw=max(math.radians(-55), min(math.radians(55), error))),
        )

    if command.strategy in {"open_new_direction", "prepare_convergence"}:
        sweep = math.radians(32 if command.strategy == "open_new_direction" else 22) * math.sin(elapsed * 1.35)
        lift = math.radians(-7 if command.strategy == "open_new_direction" else -3)
        return WheelSpeeds.stopped(), ArticulationTargets(neck_pitch=lift, head_pitch=lift, head_yaw=sweep)

    if command.strategy == "sustain_flow":
        nod = math.radians(7) * math.sin(elapsed * math.pi * 1.7)
        return WheelSpeeds.stopped(), ArticulationTargets(neck_pitch=math.radians(7), head_pitch=nod)

    nod = math.radians(5) * max(0.0, math.sin(elapsed * math.pi * 1.3))
    return WheelSpeeds.stopped(), ArticulationTargets(neck_pitch=math.radians(10), head_pitch=nod)


def apply_target_light(model: Any, command: Command) -> None:
    selected = target_pod(command.target)
    for geom_name in POD_GEOMS:
        model.geom_rgba[model.geom(geom_name).id] = (
            (0.20, 1.00, 0.42, 1.0) if geom_name == selected else (0.16, 0.16, 0.19, 1.0)
        )


def start_socket_server(state: CommandState, host: str, port: int) -> threading.Thread:
    from websockets.sync.server import serve

    def handler(connection: Any) -> None:
        last_sequence = 0
        connection.send(json.dumps({"type": "mootu.status", "message": "桥接器在线，等待动作"}, ensure_ascii=False))
        for raw in connection:
            try:
                command = parse_command(raw)
                accepted = command.sequence > last_sequence
                if accepted:
                    last_sequence = command.sequence
                    state.update(command)
                message = f"已执行 {command.strategy}" if accepted else "已忽略过期指令"
                print(f"[{command.sequence}] {command.strategy} target={command.target or '-'} {command.utterance}")
                connection.send(json.dumps({"type": "mootu.status", "sequence": command.sequence, "message": message}, ensure_ascii=False))
            except (ValueError, TypeError, json.JSONDecodeError) as error:
                connection.send(json.dumps({"type": "mootu.error", "message": str(error)}, ensure_ascii=False))

    def run() -> None:
        with serve(handler, host, port, max_size=32_768) as server:
            print(f"MooTu bridge listening on ws://{host}:{port}")
            server.serve_forever()

    thread = threading.Thread(target=run, name="mootu-websocket", daemon=True)
    thread.start()
    return thread


def validate(model_path: Path) -> None:
    model, data = load_model(model_path)
    for index, strategy in enumerate(sorted(STRATEGIES), 1):
        command = Command(index, strategy, "A", "diverge", "validation", time.monotonic())
        wheels, articulation = controls_for(model, data, command, time.monotonic())
        apply_wheel_speeds(model, data, wheels)
        apply_articulation_targets(model, data, articulation)
    print(f"validated {len(STRATEGIES)} strategies against {model_path}")


def run_simulation(model_path: Path, host: str, port: int, headless: bool, duration: float | None) -> None:
    import mujoco

    model, data = load_model(model_path)
    state = CommandState()
    start_socket_server(state, host, port)
    while data.time < 0.5:
        mujoco.mj_step(model, data)

    started = time.monotonic()
    previous_strategy = "observe"

    def step() -> None:
        nonlocal previous_strategy
        now = time.monotonic()
        command = state.read()
        wheels, articulation = controls_for(model, data, command, now)
        if command.strategy != previous_strategy and command.strategy == "observe":
            halt_base_motion(model, data)
        previous_strategy = command.strategy
        apply_wheel_speeds(model, data, wheels)
        apply_articulation_targets(model, data, articulation)
        apply_target_light(model, command)
        mujoco.mj_step(model, data)

    if headless:
        while duration is None or time.monotonic() - started < duration:
            step()
            time.sleep(max(0.0, model.opt.timestep))
        return

    import mujoco.viewer

    with mujoco.viewer.launch_passive(model, data, show_left_ui=False, show_right_ui=False) as viewer:
        with viewer.lock():
            viewer.cam.type = mujoco.mjtCamera.mjCAMERA_FREE
            viewer.cam.lookat[:] = (0.0, 0.0, 0.005)
            viewer.cam.distance = 0.17
            viewer.cam.azimuth = -90
            viewer.cam.elevation = -62
        next_frame = time.monotonic()
        while viewer.is_running() and (duration is None or time.monotonic() - started < duration):
            target_time = data.time + 1.0 / 60.0
            while data.time < target_time:
                step()
            with viewer.lock():
                viewer.opt.geomgroup[:] = 1
            viewer.sync()
            next_frame += 1.0 / 60.0
            time.sleep(max(0.0, next_frame - time.monotonic()))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", type=Path, default=DEFAULT_MODEL)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--headless", action="store_true")
    parser.add_argument("--duration", type=float)
    parser.add_argument("--validate", action="store_true")
    args = parser.parse_args()
    if args.validate:
        validate(args.model)
        return
    run_simulation(args.model, args.host, args.port, args.headless, args.duration)


if __name__ == "__main__":
    main()
