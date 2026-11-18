# All Code Is Slop (Except Mine)

- **Speaker:** Lauren Tan (poteto / "Potato"), Principal Engineer, Grok Bot @ SpaceXSI
- **Event:** AI Engineer Code Summit, published on YouTube 14 November 2026
- **Video:** <https://www.youtube.com/watch?v=O_zcc6Xl12g>
- **Duration:** 17:31

Cleaned from YouTube auto-captions (public caption mirrors), cross-checked against the AI Engineer session transcript and on-screen slides. Obvious ASR errors were corrected (for example "Graph Bot"/"Grabot" → Grok Bot, "TLA Plus" → TLA+, "invariance" → invariants, "agents.mmd" → AGENTS.md). Light filler ("uh", "you know") was removed. Numbers shown only on slides are not inserted here; they appear in the digest.

## 00:12

All right. So again, my name is Potato. I work on Grok Bot at SpaceXSI. And can I just get a quick show of hands? How many of you have ever looked at code that somebody else wrote and you thought, that's all slop? Well, I have too. But today I'm going to convince you that you can turn that slop into gold.

## 00:36

And so I did something crazy last month and I shipped 3,000 pull requests to production. Now, before agents we never really cared about volume, except for the outliers. And at my previous company we called these people coding machines. People like Bret Taylor, who famously rewrote all of Google Maps in a weekend — just an insanely productive engineer. And well, with agents, anyone can now be a coding machine.

## 01:12

And my thesis is that the job of the software engineer — the meta of being a software engineer — is figuring out how to maintain or even improve the quality of your code while massively increasing your productivity. To get there, some people like to call this a software factory. But I like to keep it simple, and I think of it as all about trust. Not blind trust, but investing in your agent's environment so you can trust that your agents are going to do the right thing.

## 01:43

Now, it takes quite a lot of effort to get there, and it took me six months to get to a point where I could ship thousands of pull requests, a lot of them in my sleep. But it's certainly possible, and it will take you much less time than I did.

## 01:56

So let's start by talking about how we move from a low-trust to a high-trust one. This inverse pyramid is how I think about where to spend time on your agent's environment. The first two layers are deterministic, so using your code itself: things like good API design, architecture, refactoring, or using lint rules, type systems, compilers, or different kinds of testing. And you can use both of these layers together to constrain what agents can do and force them to do the right thing by default.

## 02:24

Verification, both runtime and formal, are great tools to layer on to find bugs and check properties and the invariants in your system that you want to hold true, and also help you check whether or not the agent understood your goals and your intent. And then finally, you want to layer with a little bit of prose: things like rules, skills, AGENTS.md — things that require judgment.

## 02:50

But let's start with your codebase. Agents generate their outputs based on their inputs, and so the quality of the input really matters, and it just so happens that your codebase is one of the largest inputs. So whenever you're correcting your agent, think about how you can make that a deterministic check instead of adding another line to your rules or your AGENTS.md, because it's far more reproducible when it's in code and it lets you trust it more.

## 03:20

And the analogy that I like to use is that your codebase is kind of like a garden. Code used to arrive a few pull requests at a time. I remember going into work in 2024 and reviewing the three pull requests that my colleagues wrote. And today, that number is more like 300. So every engineer is now a team of hundreds or even thousands of agents, and code is arriving so rapidly that it almost feels like a continuous stream, and it almost feels organic, like a living thing.

## 03:47

And in this analogy, your codebase — the constraints that you impose, the guardrails that you put up — are the concrete foundations that the new code that your agents write grows around, just like the building in this picture. And so in many ways, the job of being a software engineer is kind of becoming like gardening.

## 04:18

Because code is the biggest input for agents, it means that any workarounds, anti-patterns, deprecated code, tech debt, is now likely to be just copied by the next agent, since it looks like the established pattern in your codebase. And it's like you have some weeds or pests growing in your garden, and then they spread everywhere before you know it. So you want to make your codebase as pristine as possible so that agents are always copying the good stuff.

## 04:51

All right, let's look at some real examples. Dune is a client framework that we created for Grok Bot to implement this idea of organic architecture. It's not really that interesting technically. You can kind of think of Dune as kind of like Next.js for Electron apps. But the interesting part of Dune is that it has a lot of constraints and lint rules that we've encoded — a lot of the lessons that we've learned building desktop applications.

## 05:15

And one such lesson is that anything that requires nuance to use well often leads to slop. Your classic example is useEffect in React, right? It has its use cases, but it's often misused. Some people joke that you need a PhD to use useEffect. In other words, it really requires a lot of nuance to use well, and agents are not good at using it. So our solution has been to just ban it in product code, and it's really only allowed in some places inside of Dune APIs. And effectively, this problem has now been categorically eliminated, and we never need to catch that during code review again.

## 06:10

Another interesting pattern that we use is context through directory structure. One anti-pattern that we saw with Cursor, which is an Electron app, is that agents would often import main-thread code into the renderer thread, which would cause long tasks and jank. So in Grok Bot and in Dune apps, we've made this very, very conventional. We have these two top-level directories literally called electron-renderer and electron-main, and imports between them are forbidden or banned by our dependency graph analyzer and some lint rules. And again, these are simple lint rules to set up, but it means one less thing that we need to review and think about during code review.

## 06:43

And then one more surprising thing that I've seen is agents using Markdown: things like documentation, code comments, rules or skills. And they use this as a place to write down their justifications for not doing the right thing. Or — I don't know if you've ever seen this — but they'll over-rotate on some small correction that you made, and they treat it like a hard rule that can never be broken ever again.

## 07:10

And here's another example from Cursor. Agents really loved using imperative timers: things like setTimeout, requestAnimationFrame, requestIdleCallback. And they were using these as quick fixes because they were really patching over an architecture clash between VS Code's imperative style and React's declarative style. So our choice of architecture actually made both the client and the agent performance much worse.

## 07:44

And if you've ever done any performance work in JavaScript, you'll know that when you have tons of timers being rapidly created and destroyed, it causes a lot of major garbage collection, which causes a lot of lag and jank. But the worst part is that agents wrote a lot of code comments, like you can see in red here, explaining why this quick fix was justified. And before you know it, we had timers spreading everywhere and the performance of the app really suffered.

## 08:12

Now in Grok Bot, we learned our lesson there and we decided to just ban 99% of comments, because they go stale easily. Humans just really don't bother reading the comments a lot anyway. And again, it gives an agent an escape hatch to justify not doing the right thing because it's hard. And the worst part about comments, though, is that they're not enforceable. So what seems well-intentioned — like, I'm going to tell the next agent not to do something — never ends up actually being anything that you can trust.

## 08:41

So in Grok Bot and in Dune, we now have lint rules that give good and very helpful error messages telling the agent to fix the root cause, the real problem, rather than just patch around it. And so our general principle is that every time we correct our agents, it turns into one of these deterministic checks, or we think about how to categorically eliminate that problem in the code through better API design, through better architecture. And if you do this enough times, you'll find that you have just less things to look out for in code review. And at some point you'll realize there's nothing left to review, and you can just let agents merge most of their own pull requests.

## 09:30

All right, moving on. Verification is also a really big part of how we make our agents more autonomous and also increase our confidence and trust in their work. And our code review process has now really shrunk into looking at verification artifacts instead: things like videos, screenshots, diagrams, formal verification.

## 09:53

And the most basic example of this is runtime verification, which is just a fancy way of saying giving your agent a way to run the code for itself and use debugging tools that human developers use as well, like the Chrome DevTools Protocol. In our runtime verification skills, we have this thing that we call a feature map. And that's basically kind of like a sitemap of all of the features that are available in your application from the user's point of view. And so with this, agents don't need to guess when you say, you know, "the thingy in the left sidebar." It gives you some shared vocabulary.

## 10:21

And we also make use of custom CLIs inside these skills so that agents can reuse the CLI and the driver every time, which cuts down on token usage and is also testable.

## 10:50

And then recently we've also started looking at formal verification. So we now use TLA+ to do some model checking of major user flows, such as notifications across multiple devices and platforms. We use Lean as well for proving certain algorithms. For example, we wrote our own custom virtualization library, and we use Lean there to check that we don't have flickering or jittering problems. And we're still experimenting with this approach overall. It seems very promising. We've already found quite a few bugs with formal verification. But it's certainly not a silver bullet, and we're treating it as another tool, another layer in our agents' environment.

## 11:16

And then this is a very fast video, but another thing that we just started looking at is property-based testing as well for UIs. So we use this library called Bombadil, and this has also caught a few UI bugs for us already.

## 11:43

Okay, so zooming out: I saw this tweet from Cindy. And six months ago she was talking about not being able to trust her agents because of subtle bugs that were getting merged. And really, what was missing for her in being able to trust her agents was the verification process. And now, six months later, she says that 70% of her daily tokens go into verification. And I'd say that that tracks with what I see as well, that most of my token usage goes to verification.

## 12:08

And if you really look closely at her process, none of these things here are new or novel techniques that we've never had before. These are just good software engineering tools, but ones that might have been prohibitively expensive to use before, as they were hard to understand or write or maintain. But agents drastically cut this cost down. And really, we are entering a golden age of software testing and verification, because agents let us test everything to a much greater degree than used to be economical.

## 12:40

And then formal verification can also help you better reason about how your product should work and whether your agents really understand your intent and goals. I made this new skill called state chart in my plugin pstack — potato stack — which helps you visualize state machines from the user's point of view. And I find this much easier to review alongside the videos and screenshots that we provide. And so that's been great.

## 13:16

Sorry for the flashback. Okay, now let's look at what the promised land looks like. What do you get in return for all of this investment? So on the Grok Bot team, our velocity is taking off and rapidly increasing. And last month, our team shipped a ridiculous 11,000 pull requests to production, which is a wild number. And our pace of releasing the client has also increased, and we cut a new stable version about once a day.

## 13:54

And then the core team is also shipping much more. And we also have a lot more casual or drive-by contributors who don't always have a lot of context, but they're also contributing. And in October, we had about 227 people who contributed at least one pull request.

## 14:10

So this velocity is accelerating. You might be thinking to yourself, isn't this going to be chaos? Isn't this going to be a bunch of slop? But actually, the number of PRs that get reverted has actually gotten lower on a relative basis and is steady at about half a percent.

## 14:18

But I think the really interesting thing about this shipping pace and this volume of pull requests is that the performance of Grok Bot has stayed not just stable, but has improved on multiple dimensions compared to when we launched. So startup, typing, opening new chats, switching chats — all of this has gotten faster. And keep in mind, Grok Bot is still an Electron app for now, so there is a ceiling, right? But it's already much faster than many other agent UIs out there. And for an Electron app with this high velocity and this many people contributing, I'd say that's pretty good.

## 15:11

So before you jump into building out a software factory and automating everything that you can: whenever you correct your agent, try and do it by improving your codebase first. Start with a lint rule to prevent new occurrences of anti-patterns, and then clean up those old patterns as well. And then make sure that your verification story is really strong.

## 15:33

A lot of this work is a prerequisite to automation anyway. And if your inner coding loop produces slop, then automating that loop just produces more slop, and you need to throw more and more and more tokens at the problem, which we all know is very expensive.

## 15:51

And once you've made these investments into your codebase, static analysis, runtime and formal verification, you'll start to find that many things become possible with these foundations, and that you can really easily build your own factory on top of these foundations.

## 16:02

And when you're ready, Grok Bot is a great way to build that outer loop. We have tons of connectors, routines that can kick off Cursor Cloud Agents and Projects, which let you orchestrate hundreds or even thousands of agents. And as a quick example: whenever we cut a new release now, Grok Bot will automatically spin up a new Cursor project for us that will fuzz the entire application, the entire build, and it will find bugs by running the app and using it like a real user. And then it's going to open fix PRs for each of those bugs that it finds, and it's going to auto-merge it — as crazy as that sounds. And that's because our codebase is good enough that pull requests tend to just be good by default, and most product code that we land no longer really requires deep human review.

## 16:53

So when you have solid foundations and good organic architecture, you can turn slop into gold, and you can ship with high velocity without compromising on quality.

## 17:09

My name is Potato, also known as Lauren. Thanks again for listening to my talk.
