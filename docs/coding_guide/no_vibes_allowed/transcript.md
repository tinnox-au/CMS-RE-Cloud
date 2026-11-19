# No Vibes Allowed: Solving Hard Problems in Complex Codebases

- **Speaker:** Dex Horthy, Founder & CEO, HumanLayer
- **Event:** AI Engineer Code Summit (AI Engineer Code 2025), published on YouTube 2 December 2025 (3 December 2025, 9:52 AM Australia/Melbourne)
- **Video:** <https://www.youtube.com/watch?v=rmvDxxNubIg>
- **Duration:** 20:31
- **Companion blog:** <https://www.humanlayer.com/blog/advanced-context-engineering>

Cleaned from the official AI Engineer corrected transcript, cross-checked against YouTube auto-captions (en-orig) and on-screen slides. Obvious filler ("uh", "um", some "like" / "you know") and stutters were removed. Numbers shown only on slides are not inserted here; they appear in the digest.

## 00:12

Hi, everybody. How y'all doing? It's exciting. I'm Dex. As they did in the great intro, I've been hacking on agents for a while. Our talk, 12-Factor Agents at AI Engineer in June, was one of the top talks of all time. I think top eight or something, one of the best ones from AI Engineer in June. May or may not have said something about context engineering.

## 00:42

Why am I here today? What am I here to talk about? I want to talk about one of my favorite talks from AI Engineer in June, and I know we all got the update from Igor yesterday, but they wouldn't let me change my slides, so this is going to be about what Igor talked about in June.

## 00:53

Basically that they surveyed 100,000 developers across all company sizes, and they found that most of the time you use AI for software engineering, you're doing a lot of rework, a lot of codebase churn. And it doesn't really work well for complex tasks, brownfield codebases. And you can see in the chart, basically you are shipping a lot more, but a lot of it is just reworking the slop that you shipped last week. And then the other side was that if you're doing greenfield, little Vercel dashboard, something like this, then it's going to work great. If you're going to go in a ten-year-old Java codebase, maybe not so much.

## 01:29

And this matched my experience personally, and talking to a lot of founders and great engineers: too much slop, tech debt factory. It's just not going to work for our codebase. Like, maybe someday when the models get better. But that's what context engineering is all about. How can we get the most out of today's models? How do we manage our context window?

## 01:46

So we talked about this in August. I have to confess something. The first time I used Claude Code, I was not impressed. It was like, okay, this is a little bit better. I get it. I like the UX. But since then, we as a team figured something out, that we were actually able to get two to three X more throughput. And we were shipping so much that we had no choice but to change the way we collaborated. We rewired everything about how we build software. It was a team of three. It took eight weeks. It was really frickin' hard. But now that we've solved it, we're never going back. This is the whole no slop thing. I think we got somewhere with this. Went super viral on Hacker News in September. We have thousands of folks who have gone onto GitHub and grabbed our Research, Plan, Implement prompt system.

## 02:28

So the goals here, which we kind of backed our way into: we need AI that can work well in brownfield codebases, that can solve complex problems. No slop, right? No more slop. And we had to maintain mental alignment. I'll talk a little bit more about what that means in a minute. And of course we want to spend — with everything, we want to spend as many tokens as possible. What we can offload meaningfully to the AI is really, really important. Super high leverage. So this is advanced context engineering for coding agents.

## 02:59

I'll start with framing this. The most naive way to use a coding agent is to ask it for something and then tell it why it's wrong and resteer it and ask and ask and ask until you run out of context or you give up or you cry. We can be a little bit smarter about this. Most people discover this pretty early on in their AI exploration: it might be better if you start a conversation and you're off track that you just start a new context window. You say, "Okay, we went down that path. Let's start again. Same prompt, same task, but this time we're going to go down this path. And don't go over there 'cause that doesn't work."

## 03:31

So how do you know when it's time to start over? If you see this — "You're absolutely right" — it's probably time to start over, right? This is what Claude says when you tell it it's screwing up.

## 03:50

So we can be even smarter about this. We can do what I call intentional compaction. And this is basically, whether you're on track or not, you can take your existing context window and ask the agent to compress it down into a markdown file. You can review this. You can tag it. And then when the new agent starts, it gets straight to work instead of having to do all that searching and codebase understanding and getting caught up.

## 04:07

What goes into compaction? Well, the question is, what takes up space in your context window? So it's looking for files. It's understanding code flow. It's editing files. It's test and build output. And if you have one of those MCPs that's dumping JSON and a bunch of UUIDs in your context window, God help you. So what should we compact? I'll give more on the specifics here, but this is a really good compaction. This is exactly what we're working on, the exact files and line numbers that matter to the problem that we're solving.

## 04:37

Why are we so obsessed with context? Because LLMs are pu— I actually got roasted on YouTube for this one. They're not pure functions 'cause they're non-deterministic, but they are stateless. And the only way to get better performance out of an LLM is to put better tokens in, and then you get better tokens out. And so every turn of the loop, when Claude is picking the next tool, or any coding agent is picking the next tool, there could be hundreds of right next steps and hundreds of wrong next steps. But the only thing that influences what comes out next is what is in the conversation so far.

## 05:11

So we're going to optimize this context window for correctness, completeness, size, and a little bit of trajectory. And the trajectory one is interesting because a lot of people say, "Well, I told the agent to do something, and it did something wrong, so I corrected it and I yelled at it, and then it did something wrong again, and then I yelled at it." And then the LLM is looking at this conversation, says, "Okay, cool, I did something wrong and the human yelled at me, and I did something wrong and the human yelled at me." So the next most likely token in this conversation is, "I better do something wrong so the human can yell at me again." So be mindful of your trajectory.

## 05:35

If you were going to invert this, the worst thing you can have is incorrect information, then missing information, and then just too much noise. If you like equations, there's a dumb equation if you want to think about it this way. Geoff Huntley did a lot of research on coding agents. He put it really well: just the more you use the context window, the worse outcomes you'll get.

## 05:55

This leads to a concept, a very, very academic concept called the dumb zone. So you have your context window. You have 168,000 tokens, roughly. Some are reserved for output and compaction. This varies by model, but we'll use Claude Code as an example here. Around the forty percent line is where you're going to start to see some diminishing returns depending on your task. If you have too many MCPs in your coding agents, you are doing all your work in the dumb zone and you're never going to get good results. People talked about this; I'm not going to talk about that one. Your mileage may vary. Forty percent is like — it depends on how complex the task is, but this is kind of a good guideline.

## 06:22

So back to compaction, or as I will call it from now on, cleverly avoiding the dumb zone. We can do sub-agents. If you have a front-end sub-agent and a back-end sub-agent and a QA sub-agent and a data scientist sub-agent, please stop. Sub-agents are not for anthropomorphizing roles, they are for controlling context.

## 06:49

And so what you can do is, if you want to go find how something works in a large codebase, you can steer the coding agent to do this if it supports sub-agents, or you can build your own sub-agent system. But basically you say, "Hey, go find how this works." And it can fork out a new context window that is going to go do all that reading and searching and finding and reading entire files and understanding the codebase, and then just return a really, really succinct message back up to the parent agent of just like, "Hey, the file you want is here." Parent agent can read that one file and get straight to work. And so this is really powerful. If you wield these correctly, you can get good responses like this, and then you can manage your context really, really well.

## 07:28

What works even better than sub-agents, or like a layer on top of sub-agents, is a workflow I call frequent intentional compaction. We're going to talk about research, plan, implement in a minute, but the point is you're constantly keeping your context window small. You're building your entire workflow around context management. So it comes in three phases: research, plan, implement, and we're going to try to stay in the smart zone the whole time.

## 07:51

So the research is all about understanding how the system works, finding the right files, staying objective. Here's a prompt you can use to do research. Here's the output of a research prompt. These are all open source. You can go grab them and play with them yourself. Planning, you're going to outline the exact steps. You're going to include file names and line snippets. You're going to be very explicit about how we're going to test things after every change. Here's a good planning prompt. Here's one of our plans. It's got actual code snippets in it. And then we're going to implement. And if you've read one of these plans, you can see very easily how the dumbest model in the world is probably not going to screw this up. So we just go through and we run the plan, and we keep the context low. As a planning prompt, like I said, it's the least exciting part of the process.

## 08:29

I wanted to put this into practice. So, working for us, I do a podcast with my buddy Vaibhav, who's the CEO of a company called Boundary ML. And I said, "Hey, I'm going to try to one-shot a fix to your three hundred thousand line Rust codebase for a programming language." And the whole episode goes in, it's like an hour and a half. I'm not going to talk through it right now. But we built a bunch of research, then we threw them out 'cause they were bad, and then we made a plan, and we made a plan without research and with research and compared all the results. It's a fun time. That was Monday night. By Tuesday morning, we were on the show, and the CTO had seen the PR and didn't realize I was doing it as a bit for a podcast, and basically was like, "Yeah, this looks good. We'll get it in the next release." I think he was a little confused. Here's the plan. But anyways, yeah, confirmed. Works in brownfield codebases and no slop.

## 09:15

But I wanted to see if we could solve complex problems. So Vaibhav was still a little skeptical. I sat down, we sat down for like seven hours on a Saturday and we shipped thirty-five thousand lines of code to BAML. One of the PRs got merged like a week later. I will say some of this is code gen. You know, you update your behavior, all the golden files update and stuff. But we shipped a lot of code that day. He estimates it was about one to two weeks in seven hours, and so cool. We can solve complex problems.

## 09:40

There are limits to this. I sat down with my buddy Blake. We tried to remove Hadoop dependencies from Parquet-Java. If you know what Parquet-Java is, I'm sorry for whatever happened to you to get you to this point in your career. It did not go well. Here's the plans. Here's the research. At a certain point, we threw everything out and we actually went back to the whiteboard. We had to actually — once we had learned where all the foot guns were, we went back to, okay, how is this actually going to fit together?

## 10:07

And this brings me to a really interesting point that Jake's going to talk about later. Do not outsource the thinking. AI cannot replace thinking, it can only amplify the thinking you have done or the lack of thinking you have done.

## 10:19

So people ask, "So Dex, this is spec-driven development, right?" No. Spec-driven development is broken. Not the idea, but the phrase. It's not well defined. This is Birgitta from ThoughtWorks. And a lot of people just say spec, and they mean a more detailed prompt. Does anyone remember this picture? Does anyone know what this is from? All right, that's a deep cut. There will never be a year of agents because of semantic diffusion. Martin Fowler said this in two thousand and six. We come up with a good term with a good definition, and then everybody gets excited and everybody starts meaning it to mean a hundred things to a hundred different people, and it becomes useless.

## 10:59

We had an agent is a person, an agent is a microservice, an agent is a chatbot, an agent is a workflow. And thank you, Simon. We're back to the beginning. An agent is just tools in a loop. This is happening to spec-driven dev. I used to have Sean's slide in the beginning of this talk, but it caused a bunch of people to focus on the wrong things. His thing of like, forget the code, it's like assembly now, and you just focus on the markdown. Very cool idea, but people say spec-driven dev is writing a better prompt, a product requirements document. Sometimes it's using verifiable feedback loops and backpressure. Maybe it is treating the code like assembly like Sean taught us. But for a lot of people it's just using a bunch of markdown files while you're coding. Or my favorite, I just stumbled upon this last week: a spec is documentation for an open source library. So it's gone. As spec-driven dev is overhyped, it's useless now. It's semantically diffused.

## 11:48

So I want to talk about four things that actually work today, the tactical and practical steps that we found working internally and with a bunch of users. We do the research, we figure out how the system works. You remember Memento? This is the best movie on context engineering, as Peter says it. This guy wakes up, he has no memory. He has to read his own tattoos to figure out who he is and what he's up to. If you don't onboard your agents, they will make stuff up.

## 12:17

And so if this is your team, this is very simplified for most of you. Most of you have much bigger orgs than this. But let's say you want to do some work over here. One thing you could do is you could put onboarding into every repo. You put a bunch of context: here's the repo, here's how it works. This is a compression of all the context in the codebase that the agent can see ahead of time before actually getting to work. This is challenging because sometimes it gets too long. As your codebase gets really big, you either have to make this longer or you have to leave information out. And so as you are reading through this, you're going to read the context of this big five million line monorepo, and you're going to use all the smart zone just to learn how it works, and you're not going to be able to do any good tool calling in the dumb zone.

## 13:01

So you can shard this down the stack. Just talking about progressive disclosure, you could split this up, right? You could just put a file in the root of every repo, and then at every level, you have additional context based on if you're working here, this is what you need to know. We don't document the files themselves 'cause they're the source of truth. But then as your agent is working, you pull in the root context, and then you pull in the sub-context. And we won't talk about any specific — you could use CLAUDE.md for this, you can use hooks for this, whatever it is. But then you still have plenty of room in the smart zone 'cause you're only pulling in what you need to know.

## 13:31

The problem with this is that it gets out of date. And so every time you ship a new feature, you need to kind of cache, invalidate, and rebuild large parts of this internal documentation. And you could use a lot of AI and make it part of your process to update this. But I want to ask a question. Between the actual code, the function names, the comments, and the documentation, does anyone want to guess what is on the Y-axis of this chart? Slop. It's actually the amount of lies you can find in any one part of your codebase. So you could make it part of your process to update this, but you probably shouldn't 'cause you probably won't.

## 14:08

What we prefer is on-demand compressed context. So if I'm building a feature that relates to SCM providers in Jira and Linear, I would just give it a little bit of steering. I would say, "Hey, we're going over in this part of the codebase over here." And a good research prompt or slash command might take you — or skill even — launch a bunch of sub-agents to take these vertical slices through the codebase, and then build up a research document that is just a snapshot of the actually true, based on the code itself, parts of the codebase that matter. We are compressing truth.

## 14:34

Planning is leverage. Planning is about compression of intent. And in plan, we're going to outline the exact steps. We'll take our research and our PRD or our bug ticket or our whatever it is, and we create a plan, and we create a plan file. So we're compacting again.

## 14:55

And I want to pause to talk about mental alignment. Does anyone know what code review is for? Mental alignment. It is about finding, making sure things are correct and stuff, but the most important thing is how do we keep everybody on the team on the same page about how the codebase is changing and why. And I can read a thousand lines of Golang every week. Sorry, I can't read a thousand. It's hard. I can do it. I don't want to. And as our team grows, all the code gets reviewed. We don't not read the code. But I, as a technical leader on the team, I can read the plans, and I can keep up to date. That's enough. I can catch some problems early, and I maintain understanding of how the system is evolving.

## 15:30

Mitchell had this really good post about how he's been putting his Amp threads on his pull requests so that you can see not just, "Hey, here's a wall of green text in GitHub," but, "Here's the exact steps. Here's the prompts. And hey, I ran the build at the end and it passed." This takes the reviewer on a journey in a way that a GitHub PR just can't. And as you're shipping more and more, two to three times as much code, it's really on you to find ways to keep your team on the same page and show them, "Here's the steps I did, and here's how we tested it manually."

## 16:02

Your goal is leverage, so you want high confidence that the model will actually do the right thing. I can't read this plan and know what actually is going to happen and what code changes are going to happen. So we've, over time, iterated towards our plans include actual code snippets of what's going to change. So your goal is leverage. You want compression of intent, and you want reliable execution. I have a physics background. We like to draw lines through the center of peaks and curves. As your plans get longer, reliability goes up, readability goes down. There's a sweet spot for you and your team and your codebase. You should try to find it. Because when we review the research and the plans, if they're good, then we can get mental alignment.

## 16:40

Don't outsource the thinking. I've said this before. This is not magic. There is no perfect prompt. You still — it will not work if you do not read the plan. So we built our entire process around you, the builder, are in back and forth with the agent, reading the plans as they're created. And then if you need peer review, you can send it to someone and say, "Hey, does this plan look right? Is this the right approach? Is this the right order to look at these things?" Jake, again, wrote a really good blog post about, like, the thing that makes research plan implement valuable is you, the human, in the loop, making sure it's correct.

## 17:11

So if you take one thing away from this talk, it should be that a bad line of code is a bad line of code. And a bad part of a plan could be a hundred bad lines of code. And a bad line of research, like a misunderstanding of how the system works and where things are, your whole thing's going to be hosed. You're going to be sending the model off in the wrong direction. And so when we're working internally and with users, we're constantly trying to move human effort and focus to the highest leverage parts of this pipeline. Don't outsource the thinking. Watch out for tools that just spew out a bunch of Markdown files just to make you feel good. I'm not going to name names here.

## 17:41

Sometimes this is overkill, and the way I like to think about this is like, yeah, you don't always need a full research plan implement. Sometimes you need more, sometimes you need less. If you're changing the color of a button, just talk to the agent and tell it what to do. If you're doing a simple plan and it's a small feature — if you're doing medium features across multiple repos, then do one research, then build a plan. Basically, the hardest problem you can solve, the ceiling goes up, the more of this context engineering compaction you're willing to do. And so if you're in the top right corner, you're probably going to have to do more.

## 18:19

A lot of people ask me, "How do I know how much context engineering to use?" It takes reps. You will get it wrong. You have to get it wrong over and over and over again. Sometimes you'll go too big. Sometimes you'll go too small. Pick one tool and get some reps. I recommend against min-maxing across Claude and Codex and all these different tools.

## 18:36

So I'm not a big acronym guy. We said spec-driven dev was broken. Research, plan, and implement I don't think will be the steps. The important part is compaction and context engineering and staying in the smart zone. But people are calling this RPI, and there's nothing I can do about it. So just be wary. There is no perfect prompt. There is no silver bullet. If you really want a hypey word, you can call this harness engineering, which is part of context engineering, and it's how you integrate with the integration points on Codex, Claude, Cursor, whatever, how you customize your codebase.

## 19:09

So what's next? I think the coding agent stuff is actually going to be commoditized. People are going to learn how to do this and get better at it, and the hard part is going to be how do you adapt your team and your workflow in the SDLC to work in a world where 99% of your code is shipped by AI? And if you can't figure this out, you're hosed, because there's kind of a rift growing where staff engineers don't adopt AI because it doesn't make them that much faster, and then junior mid-level engineers use a lot 'cause it fills in skill gaps, and then it also produces some slop, and then the senior engineers hate it more and more every week because they're cleaning up slop that was shipped by Cursor the week before. This is not AI's fault. This is not the mid-level engineer's fault. Cultural change is really hard, and it needs to come from the top if it's going to work. So if you're a technical leader at your company, pick one tool and get some reps.

## 19:54

If you want to help, we are hiring. We're building an agentic IDE to help teams of all sizes speed run the journey to 99% AI-generated code. We'd love to talk if you want to work with us. Go hit our website. Send us an email. Come find me in the hallway. Thank you all so much for your energy.
