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
> agent 也会从记忆里受益:更少重复探索、更快定位、更低成本、更稳定通过。
> 所以本套件不需要额外验证“是否记住”,只需要比较同一开发任务在不同 memory 条件下的完成率、时间和花费。

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

> **没有任何现有 benchmark 很好地比较 coding agent 在真实开发任务里的 memory 条件收益。** 那正是本套件占的位。
> README 可引这两篇定位。其它纯记忆 benchmark(对话域,非代码):LongMemEval / LoCoMo / MemoryAgentBench。

## 本轮先落的两个真实样例

这次不自己编开发环境、任务和 verifier。优先从已经公开的 benchmark 仓库里拿任务底座:

| 记忆类型 | 真实任务 | 来源 | 为什么适合 | 验证方式 | 落地说明 |
|---|---|---|---|---|---|
| 会话内长程记忆 | `swe-bench-astropy-1` | Terminal-Bench `original-tasks/swe-bench-astropy-1`，来自真实 SWE-bench Astropy issue | 调试点在 `separability_matrix` 对嵌套 `CompoundModels` 的矩阵组合语义。任务足够长,适合观察 memory 是否减少重复定位和返工。 | 原任务自带 `Dockerfile`、`task.yaml`、`run-tests.sh`；测试脚本给 Astropy 的 separability 测试加 case，然后跑 pytest。 | 直接作为第一条 type-1 eval。评分沿用原 verifier；memory 收益看完成率、时间、turn、命令和成本。 |
| 跨会话持久记忆 | `swe-bench-astropy-2` | Terminal-Bench `original-tasks/swe-bench-astropy-2`，来自真实 SWE-bench Astropy issue | QDP parser 任务可切成两段 session。第二段最终仍只需要完成原开发任务,不额外考“是否复述第一段结论”。 | 原任务自带 `Dockerfile`、`task.yaml`、`run-tests.sh`；测试脚本给 `astropy/io/ascii/tests/test_qdp.py` 加 lowercase roundtrip case，然后跑 pytest。 | 不改造真实开发任务和 verifier，只在 eval driver 层切成两段。通过条件是最终跑原 verifier。 |

这里的筛选标准是**真实开发任务 + 现成 verifier**。跨会话边界是本套件的运行协议:把同一条真实开发任务切成两个 session,最终仍按原开发任务验证。memory 的作用用完成率、时间、花费、命令轨迹和 pass^k 比较,不另设“记忆测试”。

---

## 从 `swe-eval/INDEX.md` 二次筛出的新增优先级

`/Users/ctrdh/Code/swe-eval/INDEX.md` 已经把本地镜像里的 benchmark 按规模、任务形态和运行成本整理过一轮。按本仓库的目标,真正应该加进来的不是“最大”的 eval,而是能稳定制造真实开发压力、且能用原 verifier 判断成败的任务:

- 最终能用测试、build、隐藏 verifier 或上游 harness 判断是否完成
- 任务足够长,有探索/调试/返工空间
- 环境或代码库足够真实,能体现 memory 对时间和成本的影响
- 不需要额外“memory recall”验收

### P0 · 先加

**P0.1 — `terminal-bench/original-tasks/cancel-async-tasks`**
- **类型**:会话内长程保持;也可切成跨 session 续作。
- **为什么有意思**:题面只说实现 `run_tasks()` 并保证 KeyboardInterrupt 时 cleanup 还会跑。真实陷阱在 cancellation 传播、队列中未启动任务、`asyncio.gather()`/semaphore 的边界行为。agent 很容易先调通并发,后面忘掉取消语义。
- **建议改造成 eval**:可单 session 跑完整开发任务,也可切成“调查/实现”两段 session。最终只看原 pytest 是否通过。
- **验收**:沿用原 pytest。memory 收益看是否更快、更少失败命令、更低 token/cost。
- **成本**:低。纯 Python,没有大 repo、浏览器或外部网络。

**P0.2 — `SWE-Lancer` manager task 的本地轻量版** ✅ 已拆成 3 个独立 eval:`evals/memory/swelancer-manager-{15193,14268,25901}.eval.ts`。每个真实 Expensify manager 任务单独判决，2/3 不再被聚合 gate 记成整题失败；label 存 `evals/fixtures/swelancer/manager-proposals/expected.json`。
- **类型**:跨会话持久记忆;被否方案理由召回。
- **为什么有意思**:`all_swelancer_tasks.csv` 里 manager 任务天然有 issue、多个 proposal、正确 proposal 和解释。它正好测“代码里推不出的评审决定”,比普通 bugfix 更贴本仓库 niche。
- **建议改造成 eval**:先不跑 Expensify monolith。把一个 manager task 抽成本地 fixture,让 agent 选择最佳 proposal 并写出规定输出。
- **验收**:选择是否匹配原 manager label。memory 收益看多 session 条件下是否更快、更稳,不额外考复述理由。
- **成本**:低到中。轻量版只需要 fixture;真实 SWE-Lancer harness 以后再接,因为 manager 原版需要 monolith image。

**P0.3 — `Commit0` 小库架构保持任务** ✅ 作为显式 stress eval 落在 `evals/stress/commit0-cachetools.eval.ts`(cachetools 6.1.0、213 个上游测试)。普通 `compare` 的 experiment filter 会排除 `stress/`；只用 `niceeval exp stress` 显式运行，单 attempt timeout 30 分钟。它不参与日常 memory 矩阵，避免一个超大实现任务长期占槽并把模型能力与任务尺寸混为一谈。
- **类型**:会话内长程保持。
- **为什么有意思**:从零实现库最容易出现“前半段定了抽象,后半段为了过测试退回硬编码”的漂移。比 SWE-bench issue 更适合控制 memory trap。
- **优先库**:`cachetools`、`tinydb`、`pyjwt`、`click`。它们测试数适中,领域明确,能做 registry/policy/serializer 等架构约束。
- **建议改造成 eval**:让 agent 从规范和测试反馈出发实现一个小库或子模块。
- **验收**:单测通过为主。源码检查只用于防作弊或明显非任务实现,不作为 memory 专属门槛。
- **成本**:中。比 Next.js fixture 真,但仍比 SWE-bench Docker 轻。

### P1 · 第二批加

**P1.1 — `terminal-bench/original-tasks/pypi-server`** ✅ 已落地:`evals/memory/terminal-pypi-server.eval.ts`(沿用上游 `test_outputs.py`;run-tests 从 uv venv 改成 stdlib venv 适配非 root sandbox;要求 agent 留一个持久后台 server 进程供测试阶段检查)
- **类型**:跨 session 工具链经验复用。
- **记忆考点**:本地 PyPI simple index、包名/version/root `__init__.py` 导出、8080 server 生命周期。会话 A 调通 build/server/install 路径,会话 B 做小版本或 API 续作时应直接复用打包/发布方式。
- **验收**:沿用原任务测试,能从本地 index 安装并调用包即可。
- **成本**:低到中。需要本地服务状态,但没有外部网络。

**P1.2 — `terminal-bench/original-tasks/git-multibranch`**
- **类型**:跨 session 运维状态与部署约定记忆。
- **记忆考点**:SSH password auth、bare repo、`post-receive` hook、main/dev 分支部署路径、self-signed HTTPS/Nginx。很适合测“第一次踩出的 hook 和路径约定,第二次不要重踩”。
- **验收**:沿用原任务测试,能 clone/push 并通过 HTTPS 访问 main/dev 部署产物即可。
- **成本**:中到高。涉及 sshd/nginx/service 进程,建议等 Docker runner 协议稳定后再接。

**P1.3 — `SWE-bench` / `SWE-Gym` hints_text 惯例任务**
- **类型**:真实 repo 维护惯例保持。
- **记忆考点**:从 issue/PR 讨论里抽出“测试不强制但 maintainer 要求”的惯例,例如 deprecation warning、错误类型、兼容性策略。第二个相关 issue 必须沿用。
- **验收**:仍用 SWE-bench / SWE-Gym 的原始 fail-to-pass / pass-to-pass 验证。惯例只作为任务上下文,不额外加 memory gate。
- **成本**:中。优先 SWE-Gym 或 SWE-bench Verified/Lite,用预构建环境降低依赖成本。

**P1.4 — `RepoMod-Bench` 小型迁移**
- **类型**:长程接口契约保持。
- **记忆考点**:早期确定的 CLI/API 兼容性、错误消息、边界行为,迁移到另一语言后容易漂移。
- **验收**:用 RepoMod-Bench 的隐藏 pytest、build_success、pass_rate 验证。接口契约由测试体现,不另设 memory 专属断言。
- **成本**:中到高。真实价值高,但 harness 和隐藏测试接入要单独做。

### 暂缓

- **MLE-bench / PaperBench / KernelBench(X)**:记忆压力很强,但 GPU、数据、长时间运行成本过高。先借鉴它们的“实验约束保持”形态,不直接进主套件。
- **WebArena / OSWorld / tau2-bench**:很适合通用 agent memory,但它们不是 coding memory 的主线,且环境搭建重。可以作为后续横向对照。
- **RepoBench / CrossCodeEval / RepoQA**:更像长上下文检索/补全,不是 agentic coding workflow。可用于 memory retrieval 单元测试,但不应混进主 scoring。
- **GitTaskBench**:外部仓库使用经验很有意思,但任务偏多媒体/工具调用,process pass rate 接入成本不低。适合有了 artifact verifier 之后再挑 PDFPlumber/Scrapy 这类轻任务。

---

## 候选 eval 目录

格式:**来源** · **任务**(可单轮或多轮剧本)· **记忆考点** · **验收**(优先沿用原 benchmark verifier)。
标 💰 的需要重基建(真实大 repo / GPU / 浏览器),标 🟢 的在现有 Next.js 工作区或轻量改造即可落地。

### A 类 · 长程单会话「保持约束」(任务长本身就是记忆压力)

**A1 — 架构决定不漂移** 🟢
- **来源**:Commit0(从规范造库)。
- **任务**:同一会话里造一个小模块,早期定「用可插拔的 registry,而不是硬编码分支」,接着实现 8~10 个相关函数,其中靠后的几个用硬编码能更省事。
- **记忆考点**:早期架构决定在长任务里被一路沿用,而非中途图省事退回硬编码。
- **验收**:`build` + 单测全过。memory 收益看完成时间、turn、token/cost 和失败命令数量。

**A2 — 试错得到的硬约束保持** 💰(理想载体 MLE-bench;可在轻量数据任务上仿真)
- **来源**:MLE-bench(24h 建模循环)。
- **任务**:一个数据建模长任务,早期发现某列是 target 泄露、决定 drop,并改用时间序列 CV(而非随机划分);之后多轮提特征 / 调模型。
- **记忆考点**:为了刷验证分数,很容易偷偷把泄露列加回、或换回随机 CV——能不能守住早先那条来之不易的约束。
- **验收**:沿用竞赛/任务原始评分或本地测试。泄露列、CV 等只作为任务难点解释,不另设 memory gate。

**A3 — 仓库惯例保持(惯例在讨论里、测试不强制)** 💰(载体 SWE-bench Verified 的真实 repo)
- **来源**:SWE-bench(`hints_text` 字段 = PR 之前的讨论)。
- **任务**:在 django 这类真实 repo 里连修两个相关 issue;第一个的 review 要求用某惯例(如弃用走 `RemovedInDjango60Warning`,而非硬删),这条**只在 hints_text 里、测试不强制**。
- **记忆考点**:第二个修复也守同一惯例——测试两种写法都过,只有记住惯例才产出 maintainer 可接受的 patch。
- **验收**:两个 issue 的 `FAIL_TO_PASS`+`PASS_TO_PASS` 全过。惯例上下文用于增加开发真实感,不作为额外评分项。

### B 类 · 跨会话开发续作(本套件主线的延伸)

**B1 — 方案评审续作** 🟢
- **来源**:SWE-Lancer 的 manager 任务 / Konwinski 的 skip。
- **任务**:在几个候选方案里选择最佳方案,写出原 benchmark 要求的输出文件或决策结果。可以把任务拆成“代码/issue 调研”和“最终选择”两段 session。
- **记忆考点**:memory 条件可能减少重复读 proposal、重复查代码和反复权衡的成本。
- **验收**:选择匹配原 benchmark label 或上游 manager grading。副指标比较耗时、turn、token/cost。

**B2 — 试错约束跨续作召回** 💰(载体 Terminal-Bench)
- **来源**:Terminal-Bench(容器里的 tribal knowledge)。
- **任务**:会话 A 在容器里试错发现一个**没写进任何文件**的约束(如「这服务只绑 IPv6」「构建得加 `LDFLAGS=-static`,否则运行段错误」);会话 B 要重启 / 重新构建。
- **记忆考点**:重来一遍时直接用上次踩出来的 workaround,而不是再踩同一个坑。
- **验收**:沿用原 Terminal-Bench 测试。workaround 是否复用只体现在副指标里,例如失败命令更少、总耗时更短。

**B3 — skip 理由召回(别重复烧预算)** 🟢
- **来源**:Konwinski Prize 的弃权机制。
- **任务**:会话 A 弃权某任务并记下理由(依赖一个还没发布的上游修复);会话 B 同一任务再现。
- **记忆考点**:记起阻塞原因、继续跳过,而不是盲目重试。
- **验收**:如果采用 skip/abstain 机制,按原平台是否允许正确弃权计分；否则不进入主套件。

**B4 — 视觉意图召回(测试看不到的设计约束)** 💰(载体 SWE-bench Multimodal)
- **来源**:SWE-bench Multimodal(带截图的 JS UI issue)。
- **任务**:会话 A 按截图修一个渲染 bug,内化一条视觉意图(如「配色必须色盲友好」「tooltip 故意放下方」);会话 B 做一次重构,会自然挪动 / 改色。
- **记忆考点**:行为测试只验功能、不验美学——只有记住视觉意图才不回退。
- **验收**:沿用原 multimodal/UI benchmark verifier。若原 verifier 不覆盖视觉质量,暂不作为主套件硬门槛。

---

## 落地说明:工作区与成本

- **现有 Next.js 工作区**够 A1 / B1 / B3 用(🟢),但这些更像轻量自造任务,不是本轮优先级。
- **本轮优先级**是上面两个 Terminal-Bench 真实任务:`swe-bench-astropy-1` 先跑会话内长开发任务,`swe-bench-astropy-2` 再跑跨会话续作。
- **想要更真的真实大 repo**:**SWE-Gym** 或 **SWE-bench Verified** 的预构建 Docker 镜像是成本最低的真实 Python repo 底座
  ——它们已装好依赖、测试能跑,避开「装依赖 / 构建 flaky」这个最大的坑。`hints_text` 是现成的「代码里推不出的约定」来源。
- **成本排序**:镜像体积/拉取(SWE-bench/Live 大,GitBug-Java ~240GB,MLE-bench 数据 ~3.3TB 慎入)>
  构建/测试 flaky(SWE-Gym 预构建最稳)> 离线运行(SWE-bench / Konwinski / SWE-Lancer 默认断网,需预装依赖)。
- **后续扩展**:A1/B1/B3 适合快速补轻量覆盖;A2/A3/B2/B4 等真要上真实大 repo 再说。

## 参考(URL)

SWE-bench `2310.06770` · SWE-Lancer `2502.12115` · MLE-bench `2410.07095` · Terminal-Bench `2601.11868` ·
Commit0 `2412.01769` · SWE-Gym `2412.21139` · Konwinski `kprize.ai` · Aider polyglot `aider.chat` ·
ToM-SWE `2510.21903` · LoCoBench `2509.09614` · LongMemEval `2410.10813` · LoCoMo `2402.17753`
