# Learning digest: No Vibes Allowed: Solving Hard Problems in Complex Codebases

- **Talk:** No Vibes Allowed: Solving Hard Problems in Complex Codebases
- **Speaker:** Dex Horthy (@dexhorthy), Founder & CEO, HumanLayer
- **Event / channel:** AI Engineer Code Summit (AI Engineer Code 2025), published on the AI Engineer YouTube channel
- **Published:** 2 December 2025 on YouTube (3 December 2025, 9:52 AM Australia/Melbourne)
- **Length:** 20:31
- **Link:** https://www.youtube.com/watch?v=rmvDxxNubIg
- **Official talk page (corrected transcript and slides):** https://ai.engineer/talks/rmvDxxNubIg-context-engineering-for-complex-codebases
- **Companion blog (29 August 2025, based on a 20 August Y Combinator talk):** https://www.humanlayer.com/blog/advanced-context-engineering
- **Speaker links:** [twitter.com/dexhorthy](https://twitter.com/dexhorthy), [humanlayer.com](https://www.humanlayer.com/), jobs slide: https://hlyr.dev/jobs, founders@humanlayer.dev

This talk is visually dense. Context-window diagrams, example research/plan artifacts, PR diffs, and the “hierarchy of leverage” carry a lot of the evidence. Numbers and wording Dex said out loud are unmarked below; numbers and wording that appear only on slides are labeled **(slide)**. Companion-blog details that were not said in this talk are labeled **(blog)** and are not treated as claims from the stage.

---

## What the video is about

Dex Horthy argues that today’s coding models already work in large, established (“brownfield”) codebases — if you treat the context window as a scarce engineering resource. The naive loop of chatting, correcting, and resteering fills the window with junk and pushes the model into what he calls the **dumb zone**. The alternative is **frequent intentional compaction**: repeatedly compress what the agent has learned into reviewable Markdown, start fresh, and keep utilization in the “smart zone.”

The workflow he uses to do that is **research → plan → implement**, with humans reviewing the research and the plan — not only the final diff. The acronym “RPI” is, in his view, already at risk of becoming another hype phrase. The durable idea is compaction, staying in the smart zone, and not outsourcing the thinking.

---

## Core ideas, in talk order

### 1. The problem is not “smarter models someday” (0:12–2:28)

Dex opens by pointing back to a Stanford study presented at AI Engineer in June (he says a name the official transcript renders as “Igor”; the companion blog names Yegor). They surveyed **100,000 developers** across company sizes and found that AI-assisted engineering often produces a lot of rework and codebase churn, and does not work well for complex tasks in brownfield codebases.

A chart titled **“Using AI in software engineering increases rework”** **(slide)** shows monthly output from May–December 2024, stacked as Reworked / Refactoring / Added / Removed. A box around September–December highlights a large orange “Reworked” band on top of added work. Dex’s spoken summary: you are shipping a lot more, but a lot of it is “just reworking the slop that you shipped last week.”

A second chart, **“Software Engineering Productivity Increases from AI Use / Orientative Guidelines”** **(slide)**, is a 2×2 of task complexity vs project maturity:

|  | Greenfield | Brownfield |
|---|---|---|
| High complexity | +10–15%. “Complex tasks require deeper human insight.” | +0–10%. “Constrained by outdated code & intricate dependencies.” |
| Low complexity | +35–40%. “These tasks are often repetitive and well-defined.” | +15–20%. “Legacy projects still benefit on simpler tasks.” |

He says greenfield “little Vercel dashboard” work goes great; a ten-year-old Java codebase, maybe not. That matched what he heard from founders: “Too Much Slop,” “Tech Debt Factory,” “Doesn’t work in big repos” **(slide)**. The common shrug is “maybe someday when the models get better.” His reply: that is what context engineering is for — getting the most out of *today’s* models by managing the context window.

He first shared these techniques in August (the YC talk / blog). Confession: the first time he used Claude Code, he was not impressed. Then his team of **three** spent **eight weeks** rewiring how they collaborated, got **2 to 3× more throughput**, and “now that we’ve solved it, we’re never going back.” The write-up went “super viral on Hacker News in September,” and “thousands of folks” grabbed their Research / Plan / Implement prompt system from GitHub.

### 2. Four goals, plus “spend as many tokens as possible” (2:28–2:59)

The goals they backed into **(slide)**:

1. AI works well in brownfield codebases
2. Solves complex problems
3. No slop
4. Mental alignment

Plus a punchline he treats as a fifth, slightly joking goal: **“Spend as many tokens as possible.”** The serious version is leverage — offload meaningfully to the AI, not burn tokens in a confused loop.

### 3. From the naive loop to intentional compaction (2:59–4:37)

**Naive:** ask, get it wrong, tell it why, resteer, repeat until you run out of context, give up, or cry. A clip on screen is titled “the naive way – work until you run out of context” **(slide)**.

**Slightly smarter:** when you are off track, start a *new* context window with the same task plus steering about the path that failed. The signal it is time to start over is Claude’s **“You’re absolutely right.”** **(slide)**

**Smarter still: intentional compaction.** Whether you are on track or not, ask the agent to compress the current window into a Markdown file you can review and hand to a fresh agent, so it does not redo all the searching and orientation.

A diagram titled **“Slightly smarter - intentional compaction”** **(slide)** shows a full conversation (system instructions, CLAUDE.md, builtin tools, MCP tools, many Read/Search/Write turns) being compacted with this prompt:

> Write everything we did so far to progress.md, ensure to note the approach we're taking, the steps we've done so far, and the current failure we're working on

The new window then starts with “Read progress.md” and goes to work. **(blog)** also notes you can use commit messages as a form of compaction.

What eats the window: looking for files, understanding code flow, edits to files, test/build output **(slide)**, plus MCP tools that dump JSON and UUIDs. A *good* compaction is not a vague summary. The example he puts up (later reused as research output) is a **“Component Usage Flow”** note with exact paths and line numbers for a Bash icon bug in their own UI: the modal path works because `ToolResultModal.tsx:136` calls `getToolIcon` and gets a terminal icon; the message-stream path is broken because `eventToDisplayObject.tsx:76` assigns a default wrench and lines 189–228 have no Bash override, while line 657 already has the correct Bash→Terminal mapping **(slide)**.

### 4. Why obsess over the context window (4:37–5:55)

A slide says **“LLMs are Pure Functions / Tokens in → Tokens Out.”** **(slide)** He immediately qualifies it: he got roasted on YouTube for that; they are not *pure* because they are non-deterministic, but they *are* stateless. The only lever for better output, without training the model, is better tokens in.

Every tool-choice turn has hundreds of right next steps and hundreds of wrong ones. The only thing that influences the next token is the conversation so far.

Optimize the window for four things **(slide)**:

1. **Correctness**
2. **Completeness**
3. **Size**
4. **Trajectory**

Trajectory is the subtle one. If the conversation is “the agent did something wrong, the human yelled, the agent did something wrong, the human yelled,” the next most likely continuation is “I better do something wrong so the human can yell at me again.” Be mindful of the trajectory you are writing into the window.

Inverted, the worst context problems, in order **(slide)**:

1. Incorrect information
2. Missing information
3. Too much noise

The “dumb equation” **(slide)**:

> Performance = (Correctness² × Completeness) / Size

Correctness is squared: a wrong fact in context is worse than a missing one, which is worse than mere noise.

He quotes Geoff Huntley (slide cites https://ghuntley.com/ralph/):

> The name of the game is that you only have approximately 170k of context window to work with. So it’s essential to use as little of it as possible. The more you use the context window, the worse the outcomes you’ll get.

**(blog)** expands on Huntley’s “Ralph Wiggum” loop; Dex does not walk through that in this talk.

### 5. The dumb zone, and the 40% guideline (5:55–6:35)

He names the diminishing-returns region **“the dumb zone.”** Using Claude Code as the example: a window of about **168,000 tokens**, with **23k reserved for auto-compact** and **32k reserved for output** **(slide)**. A horizontal line marks **40% context used**. Above it is “the smart zone”; below it, “the dumb zone.” The top of the window is already partly filled by system instructions, CLAUDE.md, Claude builtin tools, and MCP tools, even before the user says “go build me a dope feature” **(slide)**.

Around that 40% line, depending on the task, you start to see diminishing returns. If you have too many MCPs, “you are doing all your work in the dumb zone and you’re never going to get good results.” He does not linger on MCP bloat; others at the event already had. **YMMV** **(slide)**: it depends on task complexity; **40% is a good guideline**, not a law.

**(blog)** gives a slightly wider working range, “keeping utilization in the 40-60% range.” That wider band is not stated on stage.

### 6. Sub-agents are for context control, not “playing house” (6:35–7:28)

“If you have a front-end sub-agent and a back-end sub-agent and a QA sub-agent and a data scientist sub-agent, please stop.” The slide is blunt: **“Subagents are not for playing house.”** **(slide)** They are not for anthropomorphizing job titles. They are for controlling context.

The move: ask the parent to find how something works; it forks a *new* window that does all the Glob/Grep/Read and file-swallowing, then returns a succinct result — ideally “the file you want is here.” The parent reads that one file and starts working, with a clean window. “Subagents, wielded correctly, manage context well.” **(slide)**

### 7. Frequent intentional compaction, and research → plan → implement (7:28–8:29)

Sub-agents are useful. What works even better, or as a layer on top, is **frequent intentional compaction**: “building your ENTIRE WORKFLOW around context management” **(slide)**, constantly keeping the window small, staying in the smart zone.

The three phases:

**Research.** Understand how the system works; find all relevant files; stay objective — no bug hunting **(slide)**. Later he tightens this to: keep things objective, discourage opinions, avoid implementation planning; **“Research == Compression of Truth.”** **(slide)** He shows the actual open-source research prompt (it matches HumanLayer’s `/research_codebase` command file) and an example output: the same Component Usage Flow with file:line references.

**Plan.** Outline the exact implementation steps; include filenames, lines, and snippets; be explicit about testing after every change **(slide)**. He shows a real plan: desired end state, a “What We’re NOT Doing” list, phased work (backend first, UI later), automated vs manual success criteria, and actual code snippets **(slide)**. Example automated checks: `make -C humanlayer-wui check`, `lint`, `test` / `build` **(slide)**. Example manual checks: specific UI states when the daemon is running or stopped **(slide)**.

**Implement.** “Go write the code.” Quote on the slide: **“If properly planned, the implementation is easy and expected.”** Keep context under 40% **(slide)**. If you have actually read one of these plans, “the dumbest model in the world is probably not going to screw this up.” Implementation is “the least exciting part of the process.”

A later workflow diagram **(slide)** shows the three phases as separate context windows, with slash commands and a human gate after the artifacts:

- Research: `/research_codebase` → several `Task()` sub-agents → write `research.md` → **HUMAN REVIEW**
- Planning: `/create_plan ./research.md` → read the research, maybe more sub-agents → write `plan.md` → **HUMAN REVIEW**
- Implementation: `/implement_plan ./plan.md` → Read / Edit / Write / MultiEdit, following the plan

The important part is not the acronym. It is compaction between phases so each new window starts loaded with truth and intent, not a stale chat.

### 8. It works in brownfield code — and it has limits (8:29–10:07)

**BAML, a 300k-line Rust codebase** for a programming language (Boundary ML). Dex does a podcast with Vaibhav, the CEO. He tried to one-shot a fix; the episode is about **1 hour 27 minutes** **(slide)** (“🦄 ai that works #17”, https://hlyr.dev/he-gh). They built research, threw it out because it was bad, then compared a plan *without* research to a plan *with* research. That was Monday night. By Tuesday morning on the show, the CTO had seen the PR, did not realize it was a podcast bit, and said it looked good for the next release.

The on-screen example is issue **“BAML Linter error should occur if user writes one @ in @@assert in a test #1252”**, with a merged PR “Fix validation to reject field-level assertions in test blocks #2259” on a branch named `dexhorthy-1252-with-research` **(slide)**.

Confirmed, in his framing: works in brownfield, and no slop. But could they solve *complex* problems? Vaibhav was still skeptical. They sat for **seven hours on a Saturday** and shipped **35,000 lines of code** to BAML. One PR merged about a week later. He is honest that some of that is codegen (golden files updating). Vaibhav estimated it was about **one to two weeks of work in seven hours**.

The PR cards on screen **(slide)**:

- “Support for abort/cancel in python/go/typescript” (Draft, 10 commits): **+27,327 / −3,828**
- “Initial pass at wasm support” (Draft, 5 commits): **+9,067 / −1,894**

**(blog)** adds detail not stated on stage: Dex was “at best an amateur Rust dev” and new to the repo; the first research concluded the bug was invalid; the research-based plan fixed the issue in a better place and prescribed tests that matched repo conventions; of the two parallel PRs, the research-backed one was approved and the other closed; the Saturday split was about 3 hours of research/plans and 4 hours of implementation; each of cancellation and WASM had been estimated at 3–5 days for a senior BAML engineer.

**The limit case: Parquet-Java.** With Blake, they tried to remove Hadoop dependencies. “It did not go well.” They threw out the research and plans and went back to a whiteboard once they understood the footguns. A dependency diagram of `parquet-avro` / `parquet-hadoop` / `parquet-common` stays on screen **(slide)**. **(blog)** is more specific: research did not go deep enough through the dependency tree, and assumed classes could be moved upstream without dragging nested Hadoop dependencies. Another blog lesson: you probably need at least one person who is an expert in the codebase; in that session, neither of them was.

### 9. Do not outsource the thinking, and “spec-driven development” has semantically diffused (10:07–11:48)

“Do not outsource the thinking. AI cannot replace thinking, it can only amplify the thinking you have done or the lack of thinking you have done.”

Is this spec-driven development? His answer: no — not because the *idea* is bad, but because the *phrase* is broken. He cites Birgitta at ThoughtWorks: it is not well defined. Martin Fowler’s 2006 idea of **semantic diffusion**: a useful term gets used to mean a hundred things and becomes useless. The same thing happened to “agent” (a person, a microservice, a chatbot, a workflow) until, “thank you, Simon,” it came back to **“an agent is just tools in a loop.”** **(slide)**

He used to open with Sean Grove’s “specs are the new code / treat code like assembly” slide, but it made people focus on the wrong things. On screen, the competing definitions of SDD pile up **(slide)**:

- SDD is writing a PRD first
- SDD is using verifiable feedback loops
- SDD is treating the code like ASM
- SDD is using a bunch of MD files while coding
- “A Spec is documentation for OSS Libraries”

“It’s gone… it’s semantically diffused.” He does not want a new hype word. He wants tactics that work today.

### 10. Onboarding agents, progressive disclosure, and why always-on docs go stale (11:48–14:08)

If you do not onboard your agents, they will make things up. He cites a Peter J. Liu tweet calling *Memento* “the best movie on context engineering” **(slide)**: a man with no memory who has to read his own tattoos to know who he is. (The same idea as a stateless model that only knows what is in the window.)

A naive onboarding move is to dump a huge always-on repo brief into every session — “here’s the repo, here’s how it works.” As the codebase grows, that file either gets too long or leaves things out. In a “five million line monorepo,” you can spend the entire smart zone just reading the brief, and then do all your tool calling in the dumb zone.

**Better: shard down the stack / progressive disclosure.** **(slide)** Hierarchy: org → teams → repos → products / expertise areas → modules → directories → files. Put a short file at the repo root, and more context at each level, pulled in only when the agent is working there. Do not document the files themselves; they are the source of truth. You can implement this with CLAUDE.md, hooks, or whatever. A diagram shows `repo-context.md` → `product-context.md` → `module-context.md` → `dir-context.md` being Read() into a window that still has room in the smart zone **(slide)**. A counter-example shows a giant always-injected CLAUDE.md / AGENTS.md / constitution.md blob eating the smart zone for an “AcmeCorp” TypeScript monorepo **(slide)**.

The remaining problem: this documentation **goes out of date** every time you ship. You would have to cache-invalidate and rebuild it. You *could* make “update the docs” part of the process, “but you probably shouldn’t, because you probably won’t.”

He puts up a chart whose x-axis is **the actual code, function names, comments, and documentation**, and asks the audience to guess the y-axis. People say slop. The real y-axis is **“the amount of lies you can find in any one part of your codebase.”** Documentation is where the lies concentrate.

### 11. Prefer on-demand compressed context (14:08–14:55)

What they prefer: for a given feature, steer the agent toward the relevant slice — “we’re going over in this part of the codebase” — and let a research slash command or skill launch sub-agents that take vertical slices through the *live* code and write a snapshot that is actually true. That is compression of truth, on demand, instead of a stale always-on wiki.

Planning is then **compression of intent**: take the research plus the ticket/PRD, and compact again into a plan file.

### 12. Mental alignment is what code review is for (14:55–16:40)

“Does anyone know what code review is for?” His answer: **mental alignment.** Correctness matters, but the most important job is keeping the team on the same page about how the codebase is changing and why.

He can theoretically read a thousand lines of Go a week; he does not want to. They still review the code — “we don’t not read the code” — but as a technical lead he can stay current by reading the *plans*, catch problems early, and keep a model of how the system is evolving. A slide says **“But I can read 300 lines of implementation plan.”** **(slide)**

He cites Mitchell Hashimoto’s 3 September 2025 post about attaching Amp threads to PRs **(slide)**: not just “a wall of green text in GitHub,” but the steps, the prompts, and “I ran the build at the end and it passed.” That takes the reviewer on a journey a GitHub diff cannot. If you are shipping two to three times as much code, it is on you to show the path and the manual tests.

**Leverage in the plan itself.** A plan that is only prose is hard to trust. They iterated toward plans that include **actual code snippets of what will change** — compression of intent plus reliable execution.

He draws a physics-style plot **(slide)**: x-axis is plan length / detail; a blue “reliability” curve rises and flattens; a green “readability” curve starts high and falls; a purple “reliability + readability” curve peaks; a dashed line marks the **“readability / reliability sweet spot.”** As plans get longer, reliability goes up and readability goes down. The sweet spot is team- and codebase-specific. You have to find it. When research and plans are good, review of those artifacts *is* mental alignment.

### 13. Hierarchy of leverage, and when not to use the full workflow (16:40–18:36)

“This is not magic. There is no perfect prompt. It will not work if you do not read the plan.” The builder stays in a back-and-forth with the agent while the plan is created. Peer review can happen at the plan stage: is this the right approach, in the right order? He credits a blog post by Jake: what makes RPI valuable is the human in the loop making sure it is correct.

The one takeaway, as he says it:

> A bad line of code is a bad line of code. And a bad part of a plan could be a hundred bad lines of code. And a bad line of research, like a misunderstanding of how the system works and where things are, your whole thing’s going to be hosed.

A **“Hierarchy of Leverage”** slide goes further than the spoken line **(slide)**:

- 1 bad line of code == 1 bad line of code
- 1 bad line of plan == 10–100 bad lines of code (wrong solution)
- 1 bad line of research == 1,000+ bad lines of code (misunderstanding the system)
- 1 bad line of specification == 10,000+ bad lines of code (wrong problem)
- 1 bad line of Command / CLAUDE.md == 100,000+ bad lines of code (core infrastructure)

Caption: “Human Effort and Focus on the HIGHEST LEVERAGE parts of the pipeline.” **(slide)** Move review up the pipeline. Watch out for tools that “just spew out a bunch of Markdown files just to make you feel good.” He does not name names.

**When not to use the full workflow.** It is often overkill. A plot **(slide)** has “hardest problem you can solve” on the y-axis and “amount of compaction and context engineering” on the x-axis. The rungs, from least to most process:

| Problem size **(slide)** | Process **(slide)** |
|---|---|
| Small fixes, copy changes | Just talk to Claude |
| Small features across 3–5 files (also: greenfield apps with medium complexity) | Make a simple plan, then work the plan |
| Medium features across multiple projects and repos | Do 1 research, then build a plan, then implement phase by phase |
| Big refactors, whole new features | Multiple research steps, multiple plans broken out, many implement sessions |

The ceiling of what you can solve goes up with the amount of compaction you are willing to do. If you are in the top-right of that Stanford 2×2 (high complexity, brownfield, only +0–10% naively), you will probably need more of this, not less.

How much is enough? “It takes reps. You will get it wrong… over and over.” Sometimes too big, sometimes too small. **Pick one tool and get some reps.** He recommends against min-maxing across Claude, Codex, and every other tool at once. **(slide)**

### 14. RPI is not a silver bullet; harness engineering is a subset of context engineering (18:36–19:09)

He is “not a big acronym guy.” He already said SDD was broken; he does not think “research, plan, and implement” will be *the* steps forever. The important part is compaction, context engineering, and staying in the smart zone. People are calling it RPI anyway. “Just be wary. There is no perfect prompt. There is no silver bullet.”

If you want a hype word, call it **harness engineering**, which he treats as part of context engineering: how you hook into Codex, Claude, Cursor, and how you customize the codebase.

A Venn diagram **(slide)** is titled “Harness engineering as a subset of CTXE”:

- The large set is **Context Engineering**
- Inside it, **Building a Coding Agent** covers prompt engineering, structured outputs, RAG, state/history, memory
- Overlapping that, **Harness Engineering** covers hooks, commands, codebase design, sub-agents, MCPs

### 15. What’s next is cultural, not model-level (19:09–20:31)

Coding agents will be commoditized. People will learn this craft. The hard part is adapting the team, the workflow, and the SDLC to a world where **99% of the code is shipped by AI**. If you cannot figure that out, “you’re hosed.”

A rift he sees: staff engineers do not adopt AI because it does not make *them* much faster; junior and mid-level engineers use it a lot because it fills skill gaps, and it also produces slop; senior engineers hate it more every week because they are cleaning up slop shipped by Cursor the week before. “This is not AI’s fault. This is not the mid-level engineer’s fault.” Cultural change is hard and has to come from the top. If you are a technical leader, pick one tool and get some reps.

He closes with a hiring slide for HumanLayer’s agentic IDE, “speed-run the journey to 99% AI-generated code,” https://hlyr.dev/jobs and founders@humanlayer.dev **(slide)**.

---

## The exact workflow and prompt structures

Dex’s on-stage workflow, and the open-source Claude Code commands he tells people to grab, are the same system. The files below were fetched from [`humanlayer/humanlayer`](https://github.com/humanlayer/humanlayer) at commit `99abe673` (the historical `.claude/commands` tree the talk is pointing at). As of November 2026, `humanlayer/humanlayer` on `main` no longer ships that folder — it has `.claude/hooks` and `.claude/skills` instead. Copies of the same command files also exist in [`humanlayer/claudelayer`](https://github.com/humanlayer/claudelayer). Local copies used for this digest are in [reference_prompts/](reference_prompts/).

Artifact convention in those prompts: a `thoughts/` directory.

```
thoughts/
├── shared/
│   ├── research/     # YYYY-MM-DD-ENG-XXXX-description.md
│   ├── plans/        # YYYY-MM-DD-ENG-XXXX-description.md
│   └── prs/
├── <user>/           # e.g. allison/tickets/
└── searchable/       # hard links for search; documented paths drop only "searchable/"
```

Each serious phase starts in a **fresh context window**, loads the previous compacted artifact, and writes a new one. Human review sits on the research and the plan, not only on the diff. **(blog)** notes that only the implement step needs a git worktree; research and planning can happen on `main`.

### Research — `/research_codebase`

Frontmatter in the command file: `description: Document codebase as-is with thoughts directory for historical context`, `model: opus`.

The hard rule, repeated many times in the prompt:

> YOUR ONLY JOB IS TO DOCUMENT AND EXPLAIN THE CODEBASE AS IT EXISTS TODAY
>
> DO NOT suggest improvements or changes… DO NOT critique the implementation… ONLY describe what exists, where it exists, how it works, and how components interact.
>
> Document what IS, not what SHOULD BE.

Flow:

1. If the user named files (ticket, docs), the parent reads them **fully** (no limit/offset) *before* spawning sub-agents.
2. Decompose the question; track work with a todo list.
3. Spawn **parallel** specialized sub-agents, which exist to keep the parent’s window small:
   - `codebase-locator` — where files live
   - `codebase-analyzer` — how specific code works (no critique)
   - `codebase-pattern-finder` — existing examples (no evaluation)
   - `thoughts-locator` / `thoughts-analyzer` — historical docs, used only as supplement
   - web and Linear agents only if asked or relevant
4. Wait for **all** sub-agents, then synthesize. Live code is the source of truth; `thoughts/` is historical context. Include file:line references.
5. Write `thoughts/shared/research/YYYY-MM-DD-ENG-XXXX-description.md` with YAML frontmatter (`date`, `researcher`, `git_commit`, `branch`, `repository`, `topic`, `tags`, `status`, `last_updated`, …) and sections: Research Question, Summary, Detailed Findings, Code References, Architecture Documentation, Historical Context, Related Research, Open Questions.
6. Prefer GitHub permalinks when the commit is on main / pushed.
7. Present a short summary and offer follow-ups, which append to the same document.

A `_generic` / `_nt` variant of the command exists for repos that do not use the HumanLayer `thoughts` tool or Linear.

### Plan — `/create_plan`

Frontmatter: interactive plans, `model: opus`. The planner is told to be skeptical, thorough, and collaborative. It must **not** dump a full plan in one shot.

Five interactive steps:

1. **Context gathering.** Read all named files fully in the parent window. Then spawn locators/analyzers. Present an informed summary and only ask questions the code cannot answer.
2. **Research and discovery.** If the user corrects a misunderstanding, verify in the code; do not just accept it. Present current state, design options with pros/cons, and open questions. Get a decision.
3. **Plan structure.** Propose named phases and get buy-in on granularity *before* writing details.
4. **Write the plan** to `thoughts/shared/plans/YYYY-MM-DD-ENG-XXXX-description.md`. No unresolved questions are allowed in the final plan.
5. **Review.** Show the path, iterate until the human is satisfied.

Required plan shape (condensed from the real template):

- Overview
- Current State Analysis
- Desired End State, plus key discoveries with file:line references
- **What We’re NOT Doing**
- Implementation Approach
- **Phase N:** overview, file-level changes **with code snippets**, then success criteria split into:
  - **Automated Verification** — real commands (`make check`, `npm run typecheck`, …)
  - **Manual Verification** — UI / real-environment checks the human must confirm
  - A note to **pause after automated checks** for that human confirmation before the next phase
- Testing Strategy, Performance, Migration Notes, References (ticket, research doc, similar code)

### Implement — `/implement_plan`

Shorter prompt. Read the approved plan and every file it names, fully. Implement **one phase at a time**. Follow the plan’s intent, but if reality diverges, **stop** and report:

```
Issue in Phase [N]:
Expected: ...
Found: ...
Why this matters: ...
How should I proceed?
```

After a phase: run the automated success criteria, fix failures, check off items in the plan file, then pause:

```
Phase [N] Complete - Ready for Manual Verification
Automated verification passed: ...
Please perform the manual verification steps listed in the plan: ...
```

Do not check off manual items until the human confirms. Use sub-tasks sparingly. If the plan already has checkmarks, trust them and resume at the first unchecked item.

Related commands in the same tree, not walked through on stage: `/validate_plan` (verify the implementation against the plan after commits), `/iterate_plan`, `/oneshot_plan`.

---

## Numbers and quotes

Spoken unless marked **(slide)** or **(blog)**.

**Scale and results**

- Stanford study: 100,000 developers; AI use associated with more rework and weak results on complex brownfield work.
- Productivity 2×2 **(slide)**: greenfield + low complexity +35–40%; brownfield + high complexity +0–10%.
- Team of three; eight weeks to rewire collaboration; **2 to 3×** throughput.
- “Thousands of folks” downloaded the prompt system after a September Hacker News wave.
- BAML: **300,000-line** Rust codebase; a one-shot bugfix PR approved by the next morning.
- Saturday session: **35,000 lines** in **seven hours**; one PR merged about a week later; estimate **one to two weeks** of work compressed into that day. Some of the line count is codegen / golden files.
- PR diffs **(slide)**: cancel/abort **+27,327 / −3,828** (10 commits); WASM **+9,067 / −1,894** (5 commits).
- Parquet-Java / Hadoop removal: failed; they threw the artifacts out and went back to a whiteboard.
- **(blog, not spoken):** team of three averaging about $12k/month on Opus; intern shipped 2 PRs on day 1 and 10 on day 8; Dex shipped 6 PRs in a day; almost no hand-edits of non-markdown files in three months.

**Context window**

- Huntley: “approximately 170k” of context; “the more you use the context window, the worse the outcomes you’ll get.”
- Claude Code example: **168k** tokens; **23k** reserved for auto-compact; **32k** reserved for output **(slide)**.
- **40%** utilization is “a good guideline” for when diminishing returns start; YMMV with task complexity. Too many MCPs can put *all* work in the dumb zone.
- **(blog):** they aim for a 40–60% range.

**Leverage**

- Spoken: a bad line of code is one bad line; a bad part of a plan could be **a hundred** bad lines; a bad line of research can hose the whole effort.
- Hierarchy of leverage **(slide):** plan 10–100×; research 1,000+×; specification 10,000+× (wrong problem); Command/CLAUDE.md 100,000+× (core infrastructure).
- Slide, not spoken as a number: “I can read **300 lines** of implementation plan.”

**Quotes worth keeping**

> Maybe someday when the models get better. But that’s what context engineering is all about. How can we get the most out of today’s models?

> They’re not pure functions ’cause they’re non-deterministic, but they are stateless. And the only way to get better performance out of an LLM is to put better tokens in, and then you get better tokens out.

> The next most likely token in this conversation is, “I better do something wrong so the human can yell at me again.”

> If you have a front-end sub-agent and a back-end sub-agent and a QA sub-agent and a data scientist sub-agent, please stop. Sub-agents are not for anthropomorphizing roles, they are for controlling context.

> If you’ve read one of these plans, you can see very easily how the dumbest model in the world is probably not going to screw this up.

> Do not outsource the thinking. AI cannot replace thinking, it can only amplify the thinking you have done or the lack of thinking you have done.

> If you don’t onboard your agents, they will make stuff up.

> It’s actually the amount of lies you can find in any one part of your codebase.

> What we prefer is on-demand compressed context. … We are compressing truth.

> Planning is leverage. Planning is about compression of intent.

> The most important thing is how do we keep everybody on the team on the same page about how the codebase is changing and why.

> It will not work if you do not read the plan.

> If you’re changing the color of a button, just talk to the agent and tell it what to do.

> Research, plan, and implement I don’t think will be the steps. The important part is compaction and context engineering and staying in the smart zone.

> There is no perfect prompt. There is no silver bullet.

> This is not AI’s fault. This is not the mid-level engineer’s fault. Cultural change is really hard, and it needs to come from the top if it’s going to work.

---

## How this fits with the poteto pyramid

Lauren Tan’s pyramid, from cheapest/highest leverage to most expensive, is: **codebase → static analysis → verification → prose → human review.** Dex is mostly talking about a *per-task* process that sits across the bottom two layers (prose artifacts and human review) and, if you do it well, *feeds* the top three.

**Complementary, not competing.**

- Lauren: invest in the agent’s *environment* so the default output is good. Dex: invest in the *context you feed a given task* so the model stays in the smart zone and does not wander. You want both. A clean CMS with strict types and import boundaries still fails if the implement session is stuffed with a stale 2,000-line AGENTS.md and a yelling match about a wrong approach.
- Both distrust unenforceable Markdown. Lauren: agents use comments and AGENTS.md to justify not doing the right thing; turn corrections into lints and APIs. Dex: always-on CLAUDE.md / internal docs go stale and become “lies”; a bad line in CLAUDE.md has the largest blast radius on his leverage slide. The shared rule is: prose is for judgment and *on-demand* truth, not for a growing rulebook.
- Dex’s “on-demand compressed context” is a good way to keep Lauren’s prose layer thin. Instead of bloating AGENTS.md with every CMS invariant, run research against the live code when you need a map, then throw or update that snapshot.
- Human review in the pyramid is the expensive tip. Dex tells you *where* to spend it: research and plans, not only diffs. That is how a lead can keep mental alignment when volume goes up — which is the same “quality at much higher volume” problem Lauren is solving from the environment side.
- His implement prompt already assumes Lauren-style checks exist: each phase has automated verification commands (typecheck, lint, tests, build) and a pause for manual/runtime checks. The plan is where you *name* those checks; the pyramid is where you *make them exist*.
- “Don’t outsource the thinking” matches Lauren’s warning not to skip foundations and bolt a “software factory” onto a sloppy inner loop. Dex’s Parquet-Java miss is the same lesson: a factory pointed at a misunderstood system just produces more wrong work.

**Tensions to handle deliberately.**

- Lauren wants *more* tokens spent on verification (agents running the app, tests, formal methods). Dex wants the *implement* window kept under ~40%. These do not actually conflict if verification is done in sub-agents, in CI, or after a compaction, rather than by pasting huge test logs into the same chat that is still editing code. Dumping a noisy e2e log into the implement session is exactly the “test/build output” and “MCP JSON” failure mode he warns about.
- Lauren is happy to encode rules in directory names, lints, and banned APIs so agents need less judgment. Dex warns that huge always-injected repo briefs consume the smart zone. Progressive disclosure (a short root AGENTS.md, plus package-level notes pulled on demand) is the compromise that satisfies both: the *code and lints* carry the constraints; the *prose* stays small and situational.
- Dex’s research prompt forbids suggesting improvements. Lauren’s habit is: when you correct an agent, immediately ask what lint or API would have caught it. For the CMS adoption work, keep those jobs in different phases. Research documents what is. The *plan* (or a separate “turn this finding into a check” step) is where you propose the deterministic guardrail.
- Volume goals differ in flavor. Lauren reports thousands of PRs and a ~0.5% revert rate, with agents often verifying themselves. Dex’s story is a three-person team going 2–3× and reviewing plans to stay sane. For a small CMS team still laying foundations, Dex’s pacing (one research, one plan, one phase per PR) is the more natural first step; Lauren’s factory loop comes after the inner loop is clean.

A compact way to hold both in one head: **the pyramid decides what the agent is allowed to do; frequent intentional compaction decides what the agent is allowed to see.**

---

## Applying this to TINNOX CMS with Claude Code

The CMS is a few days old, but it is already a brownfield-shaped system from an agent’s point of view: a strict TypeScript monorepo, Fastify API, React/Vite portal, Postgres 17 with forced RLS, Keycloak, and a pairing / revocation / manifest-version protocol between portal and players. You are already adopting the poteto pyramid and had planned a phased approach: write an adoption plan first, then one step per PR, guardrail before the fix. Dex’s workflow is the missing *operating system* for that plan, and for future feature work, in Claude Code.

### Set up the commands and the artifact folder

Do not invent a new religion. Copy the *generic* HumanLayer commands (the `_generic` / `_nt` variants, so you are not tied to `humanlayer thoughts sync` or Linear) into the repo as Claude Code slash commands, then strip or rewrite HumanLayer-specific paths (`humanlayer-wui`, `make -C …`, `allison/tickets`) so they use this repo’s real commands (`lint`, typecheck, unit and integration tests, the existing CI checks).

A practical layout that sits next to the guide you already added:

```
.claude/commands/
  research_codebase.md
  create_plan.md
  implement_plan.md
  validate_plan.md          # optional, after a phase is committed
docs/coding_guide/
  poteto_pyramid/           # already on main
  horthy_no_vibes/          # this digest + transcript, when you want it in the repo
thoughts/                   # or docs/work/ if you would rather keep git history in docs/
  shared/
    research/
    plans/
```

`thoughts/` matches the prompts and Dex’s language (“compress to a file, review it, start a new window”). If you prefer everything under `docs/`, that is fine as long as the commands agree on one path. Either way, research and plans should be reviewable Markdown, dated, and linked from the PR — not left only in a chat transcript.

Keep root `AGENTS.md` / `CLAUDE.md` short: judgment calls, plus pointers to the commands and to “when you are corrected, propose a lint, type, or test, not a new prose rule.” Do **not** try to onboard agents to the whole CMS by stuffing the pairing protocol, RLS rules, and error conventions into one always-loaded file. That is the five-million-line-monorepo failure mode, even in a young repo. Progressive disclosure can come later as a *thin* `packages/db/AGENTS.md` or similar, but on-demand research is the better default, especially while the codebase is still moving fast and docs would go stale immediately.

### How this combines with the phased adoption-plan work

The adoption plan you already sketched *is* Dex’s planning phase. Run it that way, on purpose:

1. **Research (fresh window, no code changes).** `/research_codebase` on the actual repo: every AGENTS.md rule and review finding (CX-*, SCX-*, LYX-*), how it is enforced today, and where audit-outside-transaction, cross-org 404, COMMIT-outcome classification, `withOrg`, migration immutability, and skipped e2e tests live in the code. The research prompt’s “document what IS, do not critique” rule is useful here — you want a map, not a sermon. You (and CMS Dev, if you want a second reader) review that document for wrong file:line claims. A bad line of research will send the whole adoption refactor into the wrong place.
2. **Plan (new window, load the research).** `/create_plan` produces `docs/coding_guide/poteto_pyramid/adoption-plan.md` or `thoughts/shared/plans/…-poteto-adoption.md` with PR-sized phases. Each phase should name the **guardrail first** (lint, type, test, or CI check), the violations that check will surface, the fix, and automated/manual success criteria. “What we are NOT doing” should include: do not edit migrations 0001–0012; do not expand AGENTS.md; do not mix a new feature into an adoption PR. Include actual snippets for the audit-in-transaction helper and the 404 helper, not just prose. You already said you would review this plan before implementation — that is exactly Dex’s high-leverage review point.
3. **Implement (new window per step, load only that phase’s plan).** `/implement_plan` on step N only. Add the check, watch it fail on the existing violations, then fix them in the same PR so `main` stays green. Run lint, typecheck, unit and integration tests as the automated gate; pause for you to confirm anything manual (portal flows, Keycloak e2e when that exists). If the plan and the code disagree, the agent should stop and ask, not improvise a third design.
4. **After each step.** Update the plan checkboxes and the AGENTS.md “enforced by” notes. Optionally `/validate_plan`. Then start a *new* implement window for step N+1 rather than continuing in a dirty context. That is frequent intentional compaction applied to the adoption itself.

Fold the outstanding LYX-01 to 05 findings into the matching steps, and for each one ask the pyramid question — “what check would have caught this?” — inside the plan, not as a new prose rule.

For **future feature work**, use the “how much process” ladder instead of running full RPI on every change:

- Button color, copy, a one-file typo: just talk to Claude Code.
- A small feature across a few files, inner loop already guarded: a short plan, then implement.
- Anything that crosses `packages/db`, RLS, auth, org isolation, pairing, or migrations: one research doc, one plan with snippets and tests, then phase-by-phase implement. This is most CMS work that can actually hurt you.
- A large adoption or a protocol change (pairing / revocation / manifest versioning): multiple research passes are allowed, including throwing the first research out, the way Dex did on BAML. If the research is wrong, do not proceed.

Sub-agents should be used the way he means: a locator/analyzer to find how `withOrg` or the audit helper works, returning file:line, not a “backend agent” and a “frontend agent.” Keep MCP surface small so the implement window does not start already in the dumb zone.

Mental alignment for you and CMS Dev: put a link to the research and the plan in the PR (and a note of the automated checks that passed). You do not have Amp threads, but the plan file plus “here is how it was tested” is the same idea. You still read the code for security-sensitive diffs (RLS, auth, migrations); you do not try to mentally replay 1,000-line refactors without a plan.

### Five actionable takeaways

1. **Install the three commands and one artifact folder before writing more CMS code.** A `/research_codebase`, `/create_plan`, and `/implement_plan` that write into `thoughts/shared/` (or `docs/work/`) is the whole harness. Until those exist, every Claude Code session will tend to slide back into the naive resteer loop.
2. **Start the poteto adoption with research, then a plan you actually read, then one PR per phase.** Do not ask Claude Code to “apply the pyramid and refactor.” That is the button-color workflow pointed at a brownfield problem. Review the research for wrong maps; review the plan for wrong solutions; let implementation be boring.
3. **Keep AGENTS.md small and make research on-demand.** The recurring review findings you already have (audit in the same transaction, cross-org 404, immutable migrations) belong in helpers, lints, and tests, not in a longer prose file. When a new area comes up, generate a snapshot from the live code and move on.
4. **Put the human attention on the high-leverage artifacts, and put the automated attention in CI.** You should be reading research and plans; the agent should be running `lint`, typecheck, and tests after every phase; CI should refuse skipped e2e and edited migrations. Do not paste a novel of test output into the same window that is still editing `packages/db`.
5. **Match the amount of process to the danger of the change, and get reps in one tool.** Claude Code is already your implementer — do not min-max across tools while you are learning this. Use full RPI for auth, RLS, pairing, and the pyramid adoption; just talk to the agent for small UI fixes. You will occasionally over- or under-process a task. That is expected. The habit to keep is: never outsource the thinking, and never skip the review of the plan.

---

## Sources used for this digest

- YouTube video `rmvDxxNubIg`, 1280×720, downloaded with yt-dlp to `/workspace/yt/horthy/video.mp4` (152 MB), plus official auto-captions `video.en-orig.srt`.
- Official AI Engineer corrected transcript and slide text: https://ai.engineer/talks/rmvDxxNubIg-context-engineering-for-complex-codebases
- Cross-check caption mirror: https://www.withtranscript.ai/video/rmvDxxNubIg/transcript.md
- Companion blog: https://www.humanlayer.com/blog/advanced-context-engineering
- HumanLayer command and agent files from `github.com/humanlayer/humanlayer` @ `99abe673`, saved under [reference_prompts/](reference_prompts/)
- Slide frames under `/workspace/yt/horthy/frames/` and `/workspace/yt/horthy/frames/key/`
