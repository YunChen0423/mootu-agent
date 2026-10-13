import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const bridgeDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(bridgeDir, "..");
const candidates = [resolve(projectRoot, "../mootu"), resolve(projectRoot, "../../mootu")];
const mootuRoot = candidates.find((candidate) => existsSync(join(candidate, "interaction_demo.xml")));
if (!mootuRoot) throw new Error("找不到同级 mootu/interaction_demo.xml");

const python = join(mootuRoot, ".venv/bin/python");
if (!existsSync(python)) throw new Error(`找不到 MuJoCo Python 环境：${python}`);

const args = process.argv.slice(2);
const validating = args.includes("--validate");
const commandArgs = process.platform === "darwin" && !validating
  ? [join(mootuRoot, ".venv/bin/mjpython"), join(bridgeDir, "mujoco_bridge.py"), ...args]
  : [join(bridgeDir, "mujoco_bridge.py"), ...args];
const child = spawn(python, commandArgs, { stdio: "inherit" });
child.on("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exitCode = code ?? 1;
});
