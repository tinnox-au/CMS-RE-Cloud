# Learning digest: All Code Is Slop (Except Mine)

- **Talk:** All Code Is Slop (Except Mine)
- **Speaker:** Lauren Tan (poteto, also “Potato”), Principal Engineer on Grok Bot at SpaceXSI
- **Event / channel:** AI Engineer Code Summit, published on the AI Engineer YouTube channel
- **Published:** 14 November 2026
- **Length:** 17:31
- **Link:** <https://www.youtube.com/watch?v=O_zcc6Xl12g>
- **Speaker links (from the video description):** [x.com/poteto](https://x.com/poteto), [github.com/poteto](https://github.com/poteto), [pstack plugin](https://github.com/cursor/plugins/tree/main/pstack)

This talk is visually dense. Charts, architecture diagrams, and lint/code examples carry a lot of the evidence. Numbers Lauren said out loud are unmarked below; numbers that appear only on slides are labeled **(slide)**.

---

## What the video is about

Lauren Tan argues that AI-generated code stops being “slop” when you invest in the agent’s *environment* — especially the codebase, static analysis, and verification — so correct behavior is the default. The job of a software engineer, in her framing, is to keep or raise quality while massively raising agent-driven throughput, which her team illustrates with thousands of production pull requests and a steady ~0.5% revert rate.

---

## Core ideas, in talk order

### 1. The new meta is quality at much higher volume (0:00–2:03)

Lauren opens with a joke everyone in the room recognizes: other people’s code looks like slop, yours does not. The point is not that agents are uniquely messy. It is that volume used to be rare.

She says she shipped **3,000 pull requests to production last month**. A slide titled “i shipped 3,000 PRs to prod last month” shows her personal merged-PR counts rising from **68 in March** to **3,127 in October**, **10,732 total (slide)**. Before agents, teams mostly ignored volume except for outliers they called “coding machines” — she cites Bret Taylor rewriting Google Maps in a weekend. With agents, she says, anyone can be a coding machine.

**Thesis:** the meta of being a software engineer is figuring out how to *maintain or even improve* code quality while *massively increasing* productivity. Some people call that a “software factory.” She prefers a simpler word: **trust**. Not blind trust, but investment in the agent’s environment so you can trust the agent to do the right thing. It took her **six months** to reach “thousands of PRs, a lot of them in my sleep.” She thinks others can get there faster by following the same foundations.

A slide, “help agents write good code,” contrasts two loops:

- **Low trust** (“most people get stuck here”): agent writes slop → *human* verifies it → issues found → repeat.
- **High trust** (“you want to be here”): agent writes good code → *agent* verifies it → issues found → repeat.

A trust-vs-scale curve **(slide)** rises quickly from 1 agent through tens, then flattens toward a “frontier” at hundreds and thousands of agents. Trust, not model cleverness alone, is what lets you run that many agents.

### 2. The poteto pyramid: spend time on deterministic layers first (2:03–5:00)

The central framework is an inverted pyramid she calls **the poteto pyramid**, under the question “how do i trust my agents more?” A downward **cost** axis sits beside it. The wide, cheaper, highest-leverage layers are at the top; expensive human review is the tip.

From the top down **(slide wording in parentheses):**

1. **Codebase** (good API design, architecture, refactoring)
2. **Static analysis** (lints, types, compilers, tests, CI)
3. **Verification** (formal, runtime)
4. **Prose** (rules, skills, AGENTS.md)
5. **Human review**

The first two layers are **deterministic**. Used together, they constrain what agents can do and force the right thing by default. Runtime and formal verification then find bugs, check invariants, and test whether the agent understood your intent. Prose — rules, skills, AGENTS.md — comes last, and only for things that require judgment.

**Practical rule:** when you correct an agent, try to turn that correction into a deterministic check in code, not another line in AGENTS.md. Code is more reproducible, so you can trust it more. A later overlay on the same pyramid says **“code is memory.”**

### 3. Organic architecture: the codebase is a garden, and weeds copy themselves (3:20–5:00)

Because the codebase is one of the agent’s largest inputs, its quality dominates output quality. Lauren’s analogy: the codebase is a garden. In 2024 she remembers reviewing **three** colleague PRs a day; now it is more like **300**. Every engineer is “a team of hundreds or even thousands of agents,” and new code arrives like a continuous, almost living stream.

The constraints and guardrails you put in the codebase are the **concrete foundations** that new agent code grows around (illustrated with a plant-covered building she labels **Organic Architecture**). The job starts to feel like **gardening**.

The warning is mechanical, not moral: workarounds, anti-patterns, deprecated code, and tech debt now look like “the established pattern,” so the next agent copies them. A slide spells this out: **“each copy makes the next copy more likely,”** from “one workaround” to “the pattern.” You want the codebase as pristine as possible so agents copy the good stuff.

### 4. Dune: encode lessons as a framework agents cannot easily misuse (5:00–6:56)

**Dune** is the Grok Bot client framework built to implement organic architecture. Technically she shrugs it off as “like Next.js for Electron apps.” The interesting part is the constraints and lint rules that encode lessons from building desktop apps.

A slide, “dune: a framework for agents,” shows:

- an **app framework** (navigation, rendering, IPC)
- plus **one folder per feature**
- **strict import bans**
- **no comments in code**

**Lesson: “nuance tends to lead to slop — just design better APIs.”** Her classic example is React `useEffect`. It has real use cases, but it is often misused; people joke you need a PhD to use it well; agents are not good at it. So they **banned `useEffect` in product code**. It is only allowed in some places inside Dune APIs. The class of bug is categorically eliminated and no longer has to be caught in review.

**Lesson: directory structure is a form of context.** On Cursor (also an Electron app), agents often imported main-thread code into the renderer, causing long tasks and jank. In Grok Bot / Dune, two top-level directories are literally named **`electron-renderer`** and **`electron-main`**. A dependency-graph analyzer plus lint rules **forbid imports between them** — “not even types” **(slide)**. Shared types live in a `shared/` folder both sides may use. The slide also shows a side project, **tibo.dog**, where a hot path file is named `src/sim/tick.hot.ts` and annotated “runs every tick” / “no allocations” — context in the path, not in a comment. These are simple lint rules, but they remove a whole review concern.

### 5. Ban most comments; turn every correction into a lint or a better API (6:56–9:40)

A surprising failure mode: agents use Markdown — docs, comments, rules, skills — as a place to **justify not doing the right thing**. They also over-rotate on a small human correction and treat it as an unbreakable hard rule. A cartoon slide says **“stop agents from writing unsolicited markdown,”** with the agent announcing “I made it up.”

Cursor example: agents loved imperative timers (`setTimeout`, `requestAnimationFrame`, `requestIdleCallback`) as quick fixes for an architecture clash between VS Code’s imperative style and React’s declarative style. That choice made both client and agent performance worse. Rapidly created and destroyed timers caused major garbage collection, lag, and jank. Worse, agents wrote comments *justifying* the quick fix, and the pattern spread.

A slide titled **“quick fixes considered harmful” (slide)** shows the spread:

- **Sep 9:** a comment `// release later, in case it comes back` plus `setTimeout(() => release(id), 0)`, “fixes a flicker,” with the agent saying “it would be a larger change”
- **Oct 3:** `setTimeout(..., 0)` copied into a shared module
- **Oct 17:** **183 timers**

Grok Bot’s response: **ban 99% of comments**. Reasons she gives:

- comments go stale easily
- humans often do not bother reading them
- they give the agent an escape hatch to justify skipping the hard, correct fix
- they are **not enforceable**, so a well-intentioned “don’t do this” note is not something you can trust

A slide, **“comments are liabilities” (slide)**, shows comment count falling from **65,824 on 31 July** to **1,227 today**, and points to `/no-comments` in pstack at [github.com/cursor/plugins](https://github.com/cursor/plugins).

Instead, Dune lint rules give **helpful error messages** that tell the agent to fix the root cause rather than patch around it.

**General principle:** every time they correct an agent, it becomes a deterministic check, or they categorically eliminate the problem through better API design or architecture. Do that enough times and review shrinks; eventually “there’s nothing left to review,” and agents can merge most of their own PRs.

A step chart, **“whenever you correct your agent” (slide)**, shows that inventory of checks climbing from **7** around early August to **17, 38, 90, 134, 149, 157,** and **167 by 1 November**, captioned “lint against it or categorically eliminate the problem.”

### 6. Verification is how review shrinks, and where most tokens should go (9:40–13:32)

A slide overlay on the pyramid says **“verification is the most important step.”** Code review on her team has shrunk into looking at **verification artifacts**: videos, screenshots, diagrams, formal verification — not primarily raw diffs.

**Runtime verification** is “just a fancy way of saying” give the agent a way to run the code itself, using the same debugging tools humans use, such as the **Chrome DevTools Protocol**.

In their runtime verification skills they keep a **feature map**: a sitemap of the app’s features from the user’s point of view, so the agent does not have to guess what “the thingy in the left sidebar” is. It creates shared vocabulary. A slide breaks a feature map into three questions **(slide):**

- what features exist
- how users reach it
- what proves it works

They also put **custom CLIs** inside these skills so the agent reuses the same CLI and driver every time, which cuts token usage and is itself testable. The slide points to `/create-verification-skill` in pstack.

**Formal verification** is newer and still experimental, “not a silver bullet,” but already finding bugs:

- **TLA+** for model checking major user flows, e.g. notifications across multiple devices and platforms. Slide: “Model a state machine. Check that its rules hold.” / “model state machines and check that all states are correctly handled.”
- **Lean** for proving certain algorithms. They wrote a custom virtualization library and use Lean to check they do not get flickering or jittering. Slide: “Write proofs about code. Check every logical step.” / “check implementation for bugs.”

The slide points to `/create-formal-verification-skill` in pstack.

**Property-based UI testing** with **Bombadil** ([github.com/antithesishq/bombadil](https://github.com/antithesishq/bombadil) on the slide) has already caught a few UI bugs. The demo shows the Grok Bot UI being driven with random input.

She then cites a tweet from **Cindy Sridharan (@copyconstruct)**. Six months earlier, Cindy could not trust agents because subtle bugs were getting merged; verification was the missing piece. Six months later, Cindy says **70% of her daily tokens go into verification**. Lauren says that tracks with her own usage: most of her tokens go to verification too.

Cindy’s chart **(slide, dated 5 November 2026)** is a wide menu of “old” software-engineering techniques — unit, fuzz, property-based, formal verification, mutation, contract, canaries, chaos testing, and so on — with Cindy’s note that this mix has been her dream for nearly a decade, and that with agents she can finally see it partially come true, and that this is what she needs to trust agent-generated code: “It’s not optional anymore, imo.”

Lauren’s reading: none of this is novel. These tools were just too expensive to write and maintain by hand. Agents drastically cut that cost. “We are entering a golden age of software testing and verification, because agents let us test everything to a much greater degree than used to be economical.” Formal verification also helps you reason about how the product *should* work and whether agents understood your intent.

She built a **state chart** skill in her Cursor plugin **pstack** (“potato stack”) to visualize state machines from the user’s point of view, which she finds easier to review alongside videos and screenshots.

### 7. What you get back: 11,000 PRs, ~0.5% reverts, and a faster app (13:32–15:11)

On the Grok Bot team, velocity is “taking off.” **Last month the team shipped 11,000 pull requests to production.** They also cut a **new stable client about once a day**.

Slide details **(slide):**

- Team merged PRs: **809 (Jun), 1,784 (Jul), 4,203 (Aug), 5,648 (Sep), 10,926 (Oct)**; **23,370 total**. Title: “grok bot team merged 11k PRs in oct.”
- Desktop releases: **7 in August from launch** (median **44 hours** between releases), **19 in September (25 hours)**, **15 in October (28 hours)**; **41 total**.
- Contributors with at least one PR: **15 (Jun), 48 (Jul), 95 (Aug, with “launch, Aug 11”), 163 (Sep), 227 (Oct)** — matching the **227** she says out loud. Bars are stacked by PR volume into core / casual / drive-by bands (1,000+; 100–999; 10–99; 2–9; 1 PR).

The obvious fear is chaos and slop. She says the revert rate has **fallen on a relative basis** and is **steady at about half a percent**. The “revert rate” slide **(slide, “% of commits reverted”)** shows **0.98% (Jun), 0.61% (Jul), 0.47% (Aug), 0.48% (Sep), 0.47% (Oct).**

The more interesting claim, for her, is that Grok Bot’s performance is **not just stable but improved** versus launch, even though it is **still an Electron app** and therefore has a ceiling: startup, typing, opening new chats, and switching chats all got faster. For an Electron app at this velocity and contributor count, she calls that “pretty good.”

The “velocity without compromise” slide **(slide)** compares May vs now, including:

- Cold launch **2,304 ms → 1,395 ms (−39%)**; relaunch **1,348 ms → 829 ms (−39%)**; first paint, cold **2,268 ms → 1,399 ms (−39%)**
- Typing, short-chat median **3.8 ms → 2.8 ms (−26%)**; long-chat median **8.4 ms → 2.9 ms (−65%)**; long-chat p90 **9.7 ms → 3.4 ms (−65%)**
- Opening settings **112 ms → 92 ms (−18%)**; long chat cold **153 ms → 165 ms (+8%)**; long chat warm **138 ms → 86 ms (−38%)**
- Switching to a short chat **88 ms → 49 ms (−44%)**; back to a long chat **105 ms → 63 ms (−40%)**; resize window **3.0 ms → 6.9 ms (+130%)**
- Tradeoffs: idle memory **488 MiB → 545 MiB (+12%)**; idle CPU **0.40% → 0.80% (+100%)**; JS+CSS at startup **2.0 MB → 7.7 MB (+285%)**
- Footer: “there is a ceiling, but electron apps can be decently fast (i am however toying with the idea of a rust rewrite)”

### 8. Don’t automate a bad loop; build the factory on foundations (15:11–17:15)

Closing advice: **do not jump straight to a software factory.** Whenever you correct an agent, improve the codebase first: add a lint rule to stop new anti-patterns, then clean up the old ones, and make the verification story strong.

That work is a prerequisite to automation anyway. **If your inner coding loop produces slop, automating that loop just produces more slop**, and you burn ever more tokens — which is expensive. A slide restates the two loops as **“don’t automate a bad loop,”** with the caption “improve your loop before automating!” After the poteto pyramid, the high-trust loop is the one worth scaling.

Once the foundations are in (codebase, static analysis, runtime and formal verification), a factory is easy to layer on. She pitches **Grok Bot as the outer loop**: connectors and routines that kick off Cursor Cloud Agents and Projects, orchestrating hundreds or even thousands of agents.

Example already in production: whenever they cut a new release, Grok Bot automatically spins up a Cursor project that **fuzzes the entire application/build**, finds bugs by running the app like a real user, opens fix PRs, and **auto-merges** them. That sounds crazy, she says, but it works because the codebase is good enough that PRs tend to be good by default, and most product code no longer needs deep human review.

A slide, “grok bot as your outer loop,” shows a fuzz-results thread from an agent named **sandcastle (slide)**: after fuzzing the stable Linux x64 build and comparing with the previous version, **50 distinct bugs** (3 new: 0 high, 2 medium, 1 low; 47 pre-existing: 1 high, 9 medium, 37 low), with a link to x.ai/bot. Treat those thread counts as slide evidence, not something she narrated in detail.

**Close:** with solid foundations and good organic architecture, you can turn slop into gold and ship at high velocity without compromising quality.

---

## Frameworks, tools, and numbers actually in the talk

### Frameworks and practices

- The **poteto pyramid**: codebase → static analysis → verification → prose → human review
- **Organic architecture**: foundations/guardrails in the repo; agent code grows around them
- **Turn every agent correction into a deterministic check**, or eliminate the class of problem with a better API/architecture
- **Feature map** for runtime verification (shared user-facing vocabulary)
- **Reusable custom CLIs** inside verification skills (less token spend, testable)
- Review **artifacts** (videos, screenshots, diagrams, formal proofs) rather than only code
- **Do not automate a sloppy inner loop**

### Tools and artifacts named

- **Dune** — Grok Bot’s Electron client framework (“Next.js for Electron apps”), with feature folders, import bans, and almost no comments
- **pstack** (“potato stack”), a Cursor plugin: [github.com/cursor/plugins/tree/main/pstack](https://github.com/cursor/plugins/tree/main/pstack)
  - `/no-comments`
  - `/create-verification-skill`
  - `/create-formal-verification-skill`
  - **state chart** skill (visualize user-facing state machines)
- **TLA+** — model checking of major user flows (e.g. cross-device notifications)
- **Lean** — proofs about algorithms (e.g. a custom virtualization library: no flicker/jitter)
- **Bombadil** — property-based UI testing, [github.com/antithesishq/bombadil](https://github.com/antithesishq/bombadil) (URL on slide)
- **Chrome DevTools Protocol** — runtime debugging for agents
- **Cursor Cloud Agents and Projects** — used as the scaled coding/fuzzing loop
- **Grok Bot** connectors and routines — the outer loop that kicks those agents off
- React `useEffect`, `setTimeout`, `requestAnimationFrame`, `requestIdleCallback` — as cautionary examples
- AGENTS.md, rules, and skills — useful for judgment, weak as the primary control plane

### Numbers Lauren said

- 3,000 PRs she shipped to production last month
- Six months to reach thousands of PRs, many merged while she slept
- ~3 colleague PRs to review in 2024 vs ~300 now
- Ban **99%** of comments
- Cindy Sridharan: **70%** of daily tokens now go to verification; Lauren says most of hers do too
- Team shipped **11,000** PRs to production last month
- New stable client **about once a day**
- **227** people contributed at least one PR in October
- Revert rate **steady at about 0.5%**, and lower on a relative basis than before

### Additional numbers shown only on slides

- Personal PRs: 68 / 254 / 352 / 685 / 1,113 / 2,401 / 2,732 / 3,127 from March–October; 10,732 total
- Team PRs: 809 / 1,784 / 4,203 / 5,648 / 10,926 from June–October; 23,370 total
- Releases: 7 / 19 / 15 in Aug (from launch) / Sep / Oct; medians 44 / 25 / 28 hours; 41 total
- Contributors: 15 / 48 / 95 / 163 / 227 from June–October; launch marked 11 August
- Revert rate: 0.98% / 0.61% / 0.47% / 0.48% / 0.47% from June–October (% of commits reverted)
- Comments: 65,824 on 31 July → 1,227 “today”
- Lint/check inventory: 7 → 167 by 1 November
- Timer spread: one flicker workaround on 9 September → 183 timers by 17 October
- Performance May vs now: see section 7; several latency metrics improved ~26–65%, with higher idle memory/CPU and a much larger JS+CSS payload
- Fuzz thread example: 50 distinct bugs after a Linux x64 stable-build fuzz

---

## Notable quotes

> “The job of the software engineer, the meta of being a software engineer, is figuring out how to maintain or even improve the quality of your code while massively increasing your productivity.”

> “Not blind trust, but investing in your agent’s environment so you can trust that your agents are going to do the right thing.”

> “Whenever you’re correcting your agent, think about how you can make that a deterministic check instead of adding another line to your rules or your AGENTS.md, because it’s far more reproducible when it’s in code.”

> “Anything that requires nuance to use well often leads to slop.”

> “The worst part about comments, though, is that they’re not enforceable.”

> “Every time we correct our agents, it turns into one of these deterministic checks, or we think about how to categorically eliminate that problem in the code through better API design, through better architecture.”

> “If your inner coding loop produces slop, then automating that loop just produces more slop, and you need to throw more and more and more tokens at the problem.”

> “We are entering a golden age of software testing and verification, because agents let us test everything to a much greater degree than used to be economical.”

> “When you have solid foundations and good organic architecture, you can turn slop into gold, and you can ship with high velocity without compromising on quality.”

---

## Actionable takeaways

1. **Correct the codebase, not the prompt, first.** When an agent gets something wrong, add a lint rule, a type, a test, or a tighter API that makes the mistake impossible. Only use AGENTS.md / skills for genuine judgment calls. Do not keep stacking prose rules on a messy repo.

2. **Design APIs that do not require nuance.** If a primitive is easy to misuse (`useEffect`, cross-thread imports, timer workarounds), ban it in product code and offer a safer framework API. Directory layout can carry context (e.g. `electron-main` vs `electron-renderer`) and a dependency-graph lint can enforce it.

3. **Treat comments and unsolicited Markdown as liabilities.** Agents will use them as an escape hatch and copy the workaround. Prefer enforceable checks with error messages that point at the root cause. If you try a comment ban, pair it with those lints; her team went from tens of thousands of comments down to about a thousand, and published `/no-comments` in pstack.

4. **Spend most agent tokens on verification, not just generation.** Give agents a way to run the product (Chrome DevTools Protocol or equivalent), a user-facing feature map, and reusable CLIs. Add formal tools where invariants matter (TLA+ for flows, Lean for algorithms) and property-based UI testing (they use Bombadil). Review videos, screenshots, and diagrams. Look at pstack’s verification, formal-verification, and state-chart skills if you use Cursor.

5. **Improve the inner loop before you build a factory.** Automating a sloppy loop just scales slop and burns tokens. Once the repo, static analysis, and verification are strong, *then* wire an outer loop (she uses Grok Bot routines plus Cursor Cloud Agents/Projects) — for example, fuzz each release, open fix PRs, and auto-merge only because PRs are already good by default.

---

## How to study this further

- Watch with the slides in view, especially 2:03 (pyramid), 5:00 (Dune), 6:56 (comments/timers), 9:40–11:51 (verification), and 13:32 (metrics). The charts are doing real work.
- Read the cleaned transcript in [transcript.md](transcript.md).
- If you use Cursor, inspect pstack: [github.com/cursor/plugins/tree/main/pstack](https://github.com/cursor/plugins/tree/main/pstack).
