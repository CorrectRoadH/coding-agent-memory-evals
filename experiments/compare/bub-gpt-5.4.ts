import { defineExperiment } from "niceeval";
import { bubAgent } from "niceeval/adapter";

// 文件夹 compare = 唯一一组【可对比】的实验:同一批记忆 eval、同一个模型(gpt-5.4),
// 比 bub(带 tape 记忆)和 codex(无对应持久记忆机制)。`niceeval exp compare` 跑整组。
// 文件名 = <agent>-<model>。bub 默认 tape 开,所以这一个文件就够了(不再要 tape-off 对照)。
export default defineExperiment({
  description: "bub · gpt-5.4(tape on)",
  agent: bubAgent(),
  model: "gpt-5.4", // 两边钉同一个模型,差异才归因到 agent / 记忆机制
  sandbox: "docker", // 本地 docker 沙箱,零云依赖
  // 注:workspace(starter repo)上传 + 装依赖不在这儿 —— 那属于「eval 在什么上面干活」,
  // 写在各 eval 的 test(t) 里(t.sandbox.uploadDirectory + runCommand)。experiment 只管怎么跑。
  runs: 1,
  earlyExit: false, // 要完整通过率分布,以便报 pass^k
  budget: 15,
});
