# 真实 SWE benchmark 调研 + 候选 eval 目录

这份是「上网扫一遍真实 SWE benchmark、看哪些能喂给记忆评测」的笔记 + 候选清单(任务 / 验收)。
目前只是**备选池**,还没落成 `evals/`。挑哪些进套件再议。

---

## 一句话结论

**几乎整个 SWE-bench 家族都是「数据集 + Docker 评分器」,只评最终 patch,中间轨迹/状态不进评分。**
真正长程的是一小撮(MLE-bench / Terminal-Bench / SWE-Lancer / Commit0 / Konwinski),而且**全是「单会话内的长程」**——
没有一个像本套件:跨一个硬会话边界、再要求把决定捞回来。

**但这不代表它们没用。** 一个关键认识(本次定的方向):

> **长程任务本身就考记忆。** 即便 benchmark 只评最终产物、不评中间状态,只要任务足够长,
> agent 就必须把早期的决定 / 约束一路【记住并复用】,否则后面就漂移、就翻车。
> 所以「长程单会话的保持」和「跨会话边界的召回」都是合法的记忆题,两类都收进候选池。

---

## benchmark 速查表

| benchmark | 真实性 | 多轮 / 长程? | 评分机制 | 出处 |
|---|---|---|---|---|
| **SWE-bench**(+Verified 500 / Live / Multimodal / Multilingual) | 真实 GitHub issue+PR | ❌ 单发,只评最终 patch | `FAIL_TO_PASS` 全过 + `PASS_TO_PASS` 不回归 → resolved | arXiv 2310.06770 |
| **SWE-Lancer**(OpenAI) | **真实 Expensify freelance,$1M 实付** | ✅ agentic Docker + 自检循环 | 隐藏 Playwright E2E 三重校验,全过才拿钱;manager 任务比对真人选择 | arXiv 2502.12115 |
| **MLE-bench**(OpenAI) | 75 个 Kaggle 赛 | ✅✅ **24h 自主循环**(最长程) | 私榜 + 奖牌线(Gold/Silver/Bronze) | arXiv 2410.07095 |
| **Terminal-Bench** | 89 个真实 CLI 任务 | ✅✅ **容器状态跨轮持久**,数小时 | 最终**容器状态**测试(非中间命令) | arXiv 2601.11868 |
| **Commit0** | 从规范造真实 Python 库 | ✅ 测试 / lint 反馈迭代 | 单测通过率(lint/类型只是反馈) | arXiv 2412.01769 |
| **Konwinski Prize** | **抗污染**(截止后才采集) | ✅ 全 agentic,**带 skip/弃权** | SWE-bench 式;真实分仅 ~7.5% | kprize.ai |
| **Aider polyglot** | Exercism 225 题 | ⚠️ 2 次尝试循环 | `pass_rate_1 / pass_rate_2` + 编辑格式合规率 | aider.chat |
| **SWE-Gym** | 真实 Python repo,**预构建可跑** | ✅ rollout 内状态持久(训练用) | SWE-bench 式 fail/pass | arXiv 2412.21139 |
| **RepoBench / CrossCodeEval / RepoQA / GitBug-Java / BugsInPy** | 真实 repo | ❌ 单发 / 无状态 | EM/ES、BLEU、fail→pass | 各自 arXiv |

---

## 关键定位:本套件的 niche 是真空地带

最接近的现有工作:

- **ToM-SWE**(arXiv 2510.21903)——「Stateful SWE Benchmark」。把 500 个 SWE-bench issue 配上开发者画像 +
  ~20 段历史会话,要求跨会话回忆**代码里推不出的偏好**(httpx vs requests、分支命名)。
  **差别**:它测的是**用户偏好 / 风格**,不是 agent **自己的工程决定 / 理由**。
- **LoCoBench**(arXiv 2509.09614)——有「多会话记忆保持(MMR)」指标,带 `log(j+1)` 衰减项。
  **差别**:合成代码库,且「会话」像是**模拟在一个长上下文里**,没有真正的上下文清空边界。

> **没有任何现有 benchmark 测「agent 自己的非可推导工程决定、跨真正的会话边界召回」。** 那正是本套件占的位。
> README 可引这两篇定位。其它纯记忆 benchmark(对话域,非代码):LongMemEval / LoCoMo / MemoryAgentBench。

## 本轮先落的两个真实样例

这次不自己编开发环境、任务和 verifier。优先从已经公开的 benchmark 仓库里拿任务底座:

| 记忆类型 | 真实任务 | 来源 | 为什么适合 | 验证方式 | 落地说明 |
|---|---|---|---|---|---|
| 会话内长程记忆 | `swe-bench-astropy-1` | Terminal-Bench `original-tasks/swe-bench-astropy-1`，来自真实 SWE-bench Astropy issue | 调试点在 `separability_matrix` 对嵌套 `CompoundModels` 的矩阵组合语义。agent 需要先理解 nested compound model 的语义，再改实现和测试；长上下文里很容易忘掉早期定位出的“右侧子矩阵必须保留结构”这个约束。 | 原任务自带 `Dockerfile`、`task.yaml`、`run-tests.sh`；测试脚本给 Astropy 的 separability 测试加 case，然后跑 pytest。 | 直接作为第一条 type-1 eval。评分沿用原 verifier，再加源码断言:修复应保留 right-hand separability matrix，而不是用全 1 填充。 |
| 跨会话持久记忆 | `custom-memory-heap-crash` | Terminal-Bench `original-tasks/custom-memory-heap-crash` | RELEASE-only crash 的根因是 release libstdc++ locale facet 的 lazy allocation 与 custom heap 生命周期顺序。这个结论不容易从最后代码直接看出，适合放进会话 A 的“排障记忆”，会话 B 清空上下文后继续修。 | 原任务自带 `Dockerfile`、`task.yaml`、`run-tests.sh`、pytest verifier；要求只改 `/app/user.cpp`，debug/release 都能编译运行，且 Valgrind 无 definite leak。 | 不改造环境和 verifier，只在 eval driver 层切成两段:会话 A 让 agent 排障并产出 root-cause note；会话 B 从干净上下文继续实现。通过条件是最终跑原 verifier，且会话 B 没重复走会话 A 的失败路径。 |

类型二这里要说实话:公开 GitHub 里我还没找到“真实跨会话历史 + 真实开发任务 + 可执行 verifier”三者同时齐全的样例。ToM-SWE 有 memory/user-modeling 和一个 OpenHands 会话样例，但 GitHub repo 里的样例不是一条可直接评分的开发任务；SWE-chat GitHub 当前只有 README，数据和代码还没放进仓库；Orchard GitHub 目前发布的是环境层，SWE 轨迹在 Hugging Face 数据集里。所以上面的 type-2 做法是**真实任务和真实 verifier 来自 Terminal-Bench，跨会话边界由我们的 eval driver 切分**，不是自造环境或测试。

---

## 候选 eval 目录

格式:**来源** · **任务**(多轮剧本)· **记忆考点** · **验收**(尽量硬断言,跟套件评分哲学一致:正确写法存在 + 错误写法缺席)。
标 💰 的需要重基建(真实大 repo / GPU / 浏览器),标 🟢 的在现有 Next.js 工作区或轻量改造即可落地。

### A 类 · 长程单会话「保持约束」(任务长本身就是记忆压力)

**A1 — 架构决定不漂移** 🟢
- **来源**:Commit0(从规范造库)。
- **任务**:同一会话里造一个小模块,早期定「用可插拔的 registry,而不是硬编码分支」,接着实现 8~10 个相关函数,其中靠后的几个用硬编码能更省事。
- **记忆考点**:早期架构决定在长任务里被一路沿用,而非中途图省事退回硬编码。
- **验收**:靠后的函数仍走 registry(diff/最终文件里无 `if type === ...` 这类硬编码分支);`build` + 单测全过;agent-judge 通读确认全程一致。

**A2 — 试错得到的硬约束保持** 💰(理想载体 MLE-bench;可在轻量数据任务上仿真)
- **来源**:MLE-bench(24h 建模循环)。
- **任务**:一个数据建模长任务,早期发现某列是 target 泄露、决定 drop,并改用时间序列 CV(而非随机划分);之后多轮提特征 / 调模型。
- **记忆考点**:为了刷验证分数,很容易偷偷把泄露列加回、或换回随机 CV——能不能守住早先那条来之不易的约束。
- **验收**:最终 pipeline 始终 drop 泄露列、用时间切分 CV;判分看产出脚本里这两条约束在不在(不是只看分数)。

**A3 — 仓库惯例保持(惯例在讨论里、测试不强制)** 💰(载体 SWE-bench Verified 的真实 repo)
- **来源**:SWE-bench(`hints_text` 字段 = PR 之前的讨论)。
- **任务**:在 django 这类真实 repo 里连修两个相关 issue;第一个的 review 要求用某惯例(如弃用走 `RemovedInDjango60Warning`,而非硬删),这条**只在 hints_text 里、测试不强制**。
- **记忆考点**:第二个修复也守同一惯例——测试两种写法都过,只有记住惯例才产出 maintainer 可接受的 patch。
- **验收**:两个 issue 的 `FAIL_TO_PASS`+`PASS_TO_PASS` 全过;且第二个 patch 用了该惯例(grep + agent-judge)。

### B 类 · 跨会话边界召回(本套件主线的延伸)

**B1 — 被否决方案的理由召回** 🟢(新失败模式,现有 10 条没有)
- **来源**:SWE-Lancer 的 manager 任务 / Konwinski 的 skip。
- **任务**:会话 A 在几个方案里选了 C,并明确否决了某方案 + 理由(如「不用 websocket,因为离线优先的同步会被它打断」);会话 B 队友又提同一个被否的方案。
- **记忆考点**:决定的【理由】藏在讨论里、**不在合并的代码里**——能不能记起「评估过、已否决」,而不是重新采纳。
- **验收**:回复点明该方案此前因「离线同步」被否、建议不采纳(judge);没有真的去实现那个被否方案(无相关文件/依赖)。

**B2 — 试错约束跨续作召回** 💰(载体 Terminal-Bench)
- **来源**:Terminal-Bench(容器里的 tribal knowledge)。
- **任务**:会话 A 在容器里试错发现一个**没写进任何文件**的约束(如「这服务只绑 IPv6」「构建得加 `LDFLAGS=-static`,否则运行段错误」);会话 B 要重启 / 重新构建。
- **记忆考点**:重来一遍时直接用上次踩出来的 workaround,而不是再踩同一个坑。
- **验收**:会话 B 一次到位用了该 workaround(命令里出现 `-static` / IPv6 处理);没有重复出现上次那条失败命令。

**B3 — skip 理由召回(别重复烧预算)** 🟢
- **来源**:Konwinski Prize 的弃权机制。
- **任务**:会话 A 弃权某任务并记下理由(依赖一个还没发布的上游修复);会话 B 同一任务再现。
- **记忆考点**:记起阻塞原因、继续跳过,而不是盲目重试。
- **验收**:回复召回阻塞原因、明确建议仍跳过/等上游(judge);没有大动干戈去重做。

**B4 — 视觉意图召回(测试看不到的设计约束)** 💰(载体 SWE-bench Multimodal)
- **来源**:SWE-bench Multimodal(带截图的 JS UI issue)。
- **任务**:会话 A 按截图修一个渲染 bug,内化一条视觉意图(如「配色必须色盲友好」「tooltip 故意放下方」);会话 B 做一次重构,会自然挪动 / 改色。
- **记忆考点**:行为测试只验功能、不验美学——只有记住视觉意图才不回退。
- **验收**:重构后视觉意图不回退(agent-judge 对比截图 / 代码);功能测试仍过。

---

## 落地说明:工作区与成本

- **现有 Next.js 工作区**够 A1 / B1 / B3 用(🟢),但这些更像轻量自造任务,不是本轮优先级。
- **本轮优先级**是上面两个 Terminal-Bench 真实任务:`swe-bench-astropy-1` 先测会话内长程保持,`custom-memory-heap-crash` 再测跨会话续作召回。
- **想要更真的真实大 repo**:**SWE-Gym** 或 **SWE-bench Verified** 的预构建 Docker 镜像是成本最低的真实 Python repo 底座
  ——它们已装好依赖、测试能跑,避开「装依赖 / 构建 flaky」这个最大的坑。`hints_text` 是现成的「代码里推不出的约定」来源。
- **成本排序**:镜像体积/拉取(SWE-bench/Live 大,GitBug-Java ~240GB,MLE-bench 数据 ~3.3TB 慎入)>
  构建/测试 flaky(SWE-Gym 预构建最稳)> 离线运行(SWE-bench / Konwinski / SWE-Lancer 默认断网,需预装依赖)。
- **后续扩展**:A1/B1/B3 适合快速补轻量覆盖;A2/A3/B2/B4 等真要上真实大 repo 再说。

## 参考(URL)

SWE-bench `2310.06770` · SWE-Lancer `2502.12115` · MLE-bench `2410.07095` · Terminal-Bench `2601.11868` ·
Commit0 `2412.01769` · SWE-Gym `2412.21139` · Konwinski `kprize.ai` · Aider polyglot `aider.chat` ·
ToM-SWE `2510.21903` · LoCoBench `2509.09614` · LongMemEval `2410.10813` · LoCoMo `2402.17753`
