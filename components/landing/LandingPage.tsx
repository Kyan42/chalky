"use client";

import { AnimatePresence, motion, MotionConfig, useInView, useReducedMotion } from "framer-motion";
import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import styles from "./landing.module.css";

const art = "/landing/illustrations/";
const ease = [0.22, 1, 0.36, 1] as const;

// Start with the server's value, then honor the device setting after hydration.
function useMotionPreference() {
  const preference = useReducedMotion();
  const [reduced, setReduced] = useState(false);
  useEffect(() => setReduced(!!preference), [preference]);
  return reduced;
}

function Arrow() {
  return <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 12h15m-6-6 6 6-6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

function Reveal({ children, className, delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  const reduced = useMotionPreference();
  return <motion.div className={className} initial={{ opacity: 0, y: reduced ? 0 : 28 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, amount: 0.15 }} transition={{ duration: reduced ? 0 : 0.8, delay, ease }}>{children}</motion.div>;
}

function Brand({ footer = false }: { footer?: boolean }) {
  return <Link href="/" aria-label="Chalky home" className={`${styles.brand} ${footer ? styles.footerBrand : ""}`}><img src="/brand/chalk-hand.png" width="28" height="40" alt="" /><span>Chalky</span></Link>;
}

function StartLink() {
  return <Link className={styles.cta} href="/lesson">Start learning <Arrow /></Link>;
}

function HeroScene({ paused }: { paused: boolean }) {
  const video = useRef<HTMLVideoElement>(null);
  const reduced = useMotionPreference();
  useEffect(() => {
    if (!video.current) return;
    if (paused || reduced) video.current.pause();
    else void video.current.play().catch(() => {});
  }, [paused, reduced]);
  return <div className={styles.heroScene} aria-label="Chalky, sitting on a rock with a piece of chalk and a world of ideas" role="img">
    <svg className={styles.heroOrbit} viewBox="0 0 600 280" fill="none" aria-hidden="true">
      <path d="M131 194C46 171 56 98 155 64 275 23 496 36 538 111c45 82-126 159-303 137" stroke="#898575" strokeWidth="1.3" strokeDasharray="4 7" />
      <path className={styles.orbitStroke} d="M74 165C30 123 85 67 155 52" stroke="#292820" strokeWidth="1.5" strokeLinecap="round" />
      <path d="m143 48 14 3-8 11" stroke="#292820" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="m494 213 7-12 12 9-10 13Z" fill="#D7AF46" />
      <circle cx="196" cy="40" r="3" fill="#292820" />
      <path d="m405 33 4 8m-4-1 8-5" stroke="#292820" strokeWidth="1.5" />
    </svg>
    <img className={styles.heroRocks} src={`${art}rocks.svg`} alt="" width="520" height="170" />
    <video ref={video} className={styles.heroMascot} src="/mascot/chalk-in-hand.webm" autoPlay muted loop playsInline preload="auto" aria-hidden="true" />
    <img className={`${styles.floatingArt} ${styles.heroPlant}`} src={`${art}plant.svg`} alt="" width="90" height="90" />
    <img className={`${styles.floatingArt} ${styles.heroAtom}`} src={`${art}orbit.svg`} alt="" width="82" height="82" />
    <span className={styles.heroEquation}>a² + b² = c²</span>
  </div>;
}

const topics = [
  { name: "Biology", title: "A little light. A lot of life.", question: "Why do plants need sunlight?", captions: ["It starts with a little sunlight.", "Leaves use light to turn water and carbon dioxide into sugar.", "That sugar helps the plant grow. Oxygen is released along the way."], labels: ["Catch the light", "Make some food", "Keep growing"], icon: "plant" },
  { name: "Physics", title: "Falling, without falling down.", question: "Why does the Moon stay in orbit?", captions: ["Gravity pulls the Moon toward Earth.", "But the Moon is moving sideways at the same time.", "It keeps falling around Earth. That curved path is an orbit."], labels: ["Feel the pull", "Keep moving", "Find the orbit"], icon: "orbit" },
  { name: "Computer science", title: "Small connections. Big ideas.", question: "How does a neural network learn?", captions: ["A network starts with an input, like a picture.", "Connected layers turn that input into a prediction.", "Training adjusts the connections to reduce prediction errors."], labels: ["Take an input", "Connect the dots", "Learn from errors"], icon: "neuron" },
];

function DrawPath({ d, delay = 0, stroke = "currentColor", ...props }: { d: string; delay?: number; stroke?: string; strokeWidth?: number; fill?: string }) {
  const reduced = useMotionPreference();
  return <motion.path d={d} stroke={stroke} fill="none" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" initial={{ pathLength: reduced ? 1 : 0 }} animate={{ pathLength: 1 }} transition={{ duration: reduced ? 0 : 1.2, delay: reduced ? 0 : delay, ease: "easeInOut" }} {...props} />;
}

function Diagram({ topic, step }: { topic: number; step: number }) {
  const reduced = useMotionPreference();
  const appear = { initial: { opacity: reduced ? 1 : 0 }, animate: { opacity: 1 }, transition: { duration: reduced ? 0 : 0.6 } };
  return <svg className={styles.diagram} viewBox="0 0 820 360" role="img" aria-label={topics[topic].captions[step]}>
    {topic === 0 ? <>
      <g className={styles.sun}><circle cx="175" cy="90" r="30" fill="#E9C65D" /><DrawPath d="M172 49v-14m32 24 10-11m-1 39 16-1m-24 30 11 10m-43 5v15m-30-29-11 12m-5-41h-16m33-28-11-12" /><text x="175" y="173" textAnchor="middle">sunlight</text></g>
      <DrawPath d="M403 292c-8-55 8-96 1-155" stroke="#677441" strokeWidth={4} />
      <motion.path d="M404 217c-65 5-94-32-91-69 57-2 93 20 91 69Z" fill="#A0AC78" {...appear} />
      <motion.path d="M407 179c-3-58 34-84 77-76 4 52-24 83-77 76Z" fill="#BAC58C" {...appear} />
      <DrawPath d="m404 217-65-48m68 10 54-52M320 295c51 4 121 3 169-1" />
      <DrawPath d="M221 97c41 0 85 17 116 43m-18-1 19 3-5-18" stroke="#BC8C24" delay={0.3} />
      {step >= 1 && <motion.g {...appear}>
        <DrawPath d="M247 248c51 12 70 2 101-8m-14-7 15 7-9 13" stroke="#6B867C" />
        <text x="238" y="232" textAnchor="middle">water + CO₂</text>
        <rect x="504" y="227" width="128" height="44" rx="22" fill="#F0E3BB" /><text x="568" y="255" textAnchor="middle">plant food</text>
        <DrawPath d="M426 232c26 16 41 18 65 16m-9-9 10 9-11 9" />
      </motion.g>}
      {step >= 2 && <motion.g {...appear}>
        <DrawPath d="M492 128c40 9 68-1 95-25m-14 0 16-2-2 15" stroke="#677441" />
        <text x="627" y="105" textAnchor="middle">oxygen</text>
        <path d="M407 267c0-29 26-43 49-38-2 30-22 42-49 38Z" fill="#7B8C55" /><DrawPath d="m410 265 31-22" />
        <text x="409" y="333" textAnchor="middle" className={styles.diagramAnnotation}>a pretty good trade.</text>
      </motion.g>}
    </> : topic === 1 ? <>
      <circle cx="395" cy="180" r="58" fill="#A9B6A1" stroke="#292820" strokeWidth="2" />
      <path d="m362 137 19 10 3 23-16 18 6 25-22-10-13-25 4-27m67-27 12 25 24 9-3 25-27 2-8 30-16 11-4-41-17-17 19-18" fill="#75896D" />
      <text x="395" y="268" textAnchor="middle">Earth</text>
      <circle cx="606" cy="108" r="22" fill="#D5CDB8" stroke="#292820" strokeWidth="2" />
      <text x="659" y="110" textAnchor="middle">Moon</text>
      <DrawPath d="m575 120-88 32m13-15-15 16 22 4" stroke="#B88722" />
      <text x="523" y="184" textAnchor="middle">gravity</text>
      {step >= 1 && <motion.g {...appear}><DrawPath d="m605 78-42-42m2 17-4-19 20 5" stroke="#75896D" /><text x="589" y="29" textAnchor="middle">sideways motion</text></motion.g>}
      {step >= 2 && <motion.g {...appear}><DrawPath d="M604 108C540 8 270 16 191 132s52 207 220 197 251-105 215-181" stroke="#827660" /><text x="203" y="298" className={styles.diagramAnnotation}>always falling, always missing.</text></motion.g>}
    </> : <>
      <rect x="94" y="128" width="86" height="86" rx="6" fill="#EEE6CF" stroke="#292820" strokeWidth="2" />
      <path d="m108 195 23-30 18 17 12-11 9 24Z" fill="#B4BE8F" /><circle cx="154" cy="149" r="7" fill="#D5AB41" />
      <text x="137" y="251" textAnchor="middle">a picture</text>
      <DrawPath d="M193 171h54m-12-9 13 9-13 9" />
      {[95, 171, 247].map(y => <circle key={y} cx="290" cy={y} r="17" fill="#E5C977" stroke="#292820" strokeWidth="2" />)}
      {step >= 1 && <motion.g {...appear}>
        {[95, 171, 247].flatMap(y => [75, 139, 203, 267].map(y2 => <DrawPath key={`${y}-${y2}`} d={`M307 ${y} 405 ${y2}`} stroke="#B9B5A6" strokeWidth={1.3} />))}
        {[75, 139, 203, 267].flatMap(y => [123, 219].map(y2 => <DrawPath key={`${y}-${y2}`} d={`M439 ${y} 535 ${y2}`} stroke="#B9B5A6" strokeWidth={1.3} />))}
        {[75, 139, 203, 267].map(y => <circle key={y} cx="422" cy={y} r="17" fill="#E5C977" stroke="#292820" strokeWidth="2" />)}
        {[123, 219].map(y => <circle key={y} cx="552" cy={y} r="17" fill="#A9B78E" stroke="#292820" strokeWidth="2" />)}
        <DrawPath d="M580 171h48m-12-9 13 9-13 9" /><text x="688" y="178" textAnchor="middle">“a leaf?”</text><text x="422" y="318" textAnchor="middle">connected layers</text>
      </motion.g>}
      {step >= 2 && <motion.g {...appear}><DrawPath d="M690 215c0 112-430 145-431 73m-8 9 8-11 9 11" stroke="#B88722" /><text x="704" y="267" textAnchor="middle" className={styles.diagramAnnotation}>adjust + try again</text></motion.g>}
    </>}
  </svg>;
}

function WhiteboardDemo({ motionPaused }: { motionPaused: boolean }) {
  const [topic, setTopic] = useState(0);
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [replay, setReplay] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { amount: 0.35 });
  const reduced = useReducedMotion();
  const manual = motionPaused || !!reduced;
  useEffect(() => {
    if (!inView || !playing || motionPaused || reduced || step === 2) return;
    const timeout = window.setTimeout(() => setStep(s => Math.min(s + 1, 2)), 4000);
    return () => window.clearTimeout(timeout);
  }, [inView, playing, step, topic, replay, motionPaused, reduced]);
  function selectTopic(index: number) { setTopic(index); setStep(0); setPlaying(true); setReplay(r => r + 1); }
  return <div className={styles.demo} ref={ref}>
    <div className={styles.demoTop}>
      <div className={styles.topicTabs} role="tablist" aria-label="Example lesson subjects">
        {topics.map((t, i) => <button key={t.name} id={`topic-${i}`} role="tab" aria-selected={i === topic} aria-controls="lesson-preview" tabIndex={i === topic ? 0 : -1} onClick={() => selectTopic(i)} onKeyDown={e => { if (["ArrowRight", "ArrowLeft", "Home", "End"].includes(e.key)) { e.preventDefault(); const next = e.key === "Home" ? 0 : e.key === "End" ? 2 : (i + (e.key === "ArrowRight" ? 1 : 2)) % 3; selectTopic(next); document.getElementById(`topic-${next}`)?.focus(); } }}>{t.name}</button>)}
      </div>
      <span className={styles.previewLabel}>Interactive preview</span>
    </div>
    <div id="lesson-preview" role="tabpanel" aria-labelledby={`topic-${topic}`} className={styles.demoBoard}>
      <div className={styles.boardHeading}><h3>{topics[topic].title}</h3></div>
      <div className={styles.diagramStage} key={`${topic}-${replay}`}><Diagram topic={topic} step={step} /></div>
      <div className={styles.boardCaption}><img src="/brand/chalk-hand.png" width="21" height="30" alt="" /><p aria-live="polite">{topics[topic].captions[step]}</p></div>
    </div>
    <div className={styles.demoBottom}>
      <div className={styles.stepButtons}>{topics[topic].labels.map((label, i) => <button key={label} aria-pressed={step === i} onClick={() => { setStep(i); setPlaying(false); }}><span>{i + 1}</span><span>{label}</span></button>)}</div>
      <button className={styles.playButton} aria-label={step === 2 ? "Replay example" : manual ? "Next example step" : playing ? "Pause example" : "Play example"} onClick={() => { if (step === 2) { setStep(0); setReplay(r => r + 1); setPlaying(true); } else if (manual) setStep(s => Math.min(s + 1, 2)); else setPlaying(p => !p); }}>
        {step === 2 ? <><span aria-hidden="true">↺</span> Replay</> : manual ? <><span aria-hidden="true">→</span> Next</> : playing ? <><span aria-hidden="true">Ⅱ</span> Pause</> : <><span aria-hidden="true">▷</span> Play</>}
      </button>
    </div>
  </div>;
}

const conversations = [
  { label: "An analogy", question: "Wait, explain it like I’m a gardener.", answer: "Think of a neural network as paths through a garden. Learning changes which paths are most useful." },
  { label: "A slower pace", question: "Can we take that one step at a time?", answer: "Of course. Let’s stay with the first idea, then build from there together." },
  { label: "A new direction", question: "Actually, why do we dream?", answer: "New question, new direction. Let’s start with what happens in your brain when you sleep." },
];

function Conversation() {
  const [active, setActive] = useState(0);
  return <div className={styles.conversation}>
    <div className={styles.wave} aria-hidden="true">{Array.from({ length: 31 }, (_, i) => <span key={i} style={{ height: `${Math.round(12 + Math.sin(i * 0.8) ** 2 * 42 + Math.sin(i * 1.3) ** 2 * 18)}px`, animationDelay: `${(i * -0.13).toFixed(2)}s` }} />)}</div>
    <div className={styles.conversationExample} aria-live="polite">
      <AnimatePresence mode="wait"><motion.div key={active} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.25 }}><p className={styles.youSaid}>You</p><p className={styles.voiceQuestion}>“{conversations[active].question}”</p><div className={styles.chalkySaid}><img src="/brand/chalk-hand.png" width="22" height="31" alt="" /><span>{conversations[active].answer}</span></div></motion.div></AnimatePresence>
    </div>
    <div className={styles.conversationChoices} aria-label="Example conversation directions">{conversations.map((c, i) => <button key={c.label} aria-pressed={i === active} onClick={() => setActive(i)}>{c.label}<Arrow /></button>)}</div>
    <p className={styles.exampleNote}>Example conversation</p>
  </div>;
}

const questions = [
  { q: "What can I learn with Chalky?", a: "Start with a topic or a question, from photosynthesis and physics to code and history. Chalky explains it out loud and uses the whiteboard to help you follow the idea. You can ask a follow-up whenever you need one." },
  { q: "Can I interrupt or change the subject?", a: "Yes. With your microphone on, you can jump in, ask for a different explanation, or take the conversation somewhere new. Use Mute whenever you want Chalky to stop listening." },
  { q: "Do I need to know anything before I start?", a: "Just bring a question. Tell Chalky what you already know, what feels confusing, and how much detail you want. You can ask for an analogy, a drawing, or a smaller first step." },
  { q: "Is Chalky always right?", a: "Chalky is an AI tutor and can make mistakes. Ask it to explain its reasoning and check important facts against your course materials or a trusted source. Curiosity includes asking, “Are you sure?”" },
];

export function LandingPage() {
  const [motionPaused, setMotionPaused] = useState(false);
  const reduced = useMotionPreference();
  const paused = motionPaused || !!reduced;
  return <MotionConfig reducedMotion="user"><main className={styles.landing} data-motion={paused ? "paused" : "playing"}>
    <a className={styles.skipLink} href="#how-it-works">Skip to content</a>
    <header className={styles.header}><Brand /><nav aria-label="Main navigation"><a href="#how-it-works">How it works</a><a href="#whiteboard">The whiteboard</a><a href="#questions">A few questions</a></nav><Link href="/lesson" className={styles.navCta}>Meet Chalky <Arrow /></Link></header>

    <section className={styles.hero} aria-labelledby="hero-title">
      <motion.div initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 1, ease }}><HeroScene paused={paused} /></motion.div>
      <motion.div initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.9, delay: 0.15, ease }}>
        <h1 id="hero-title">For the joy of<br />figuring it out.</h1>
        <p className={styles.heroDescription}>Meet Chalky, your personal AI tutor.<br />Talk it through. Draw it out. Make it click.</p>
        <StartLink />
      </motion.div>
    </section>

    <section className={styles.subjectStrip} aria-label="Subjects you can explore"><div role="list">{[{ label: "Biology", icon: "plant" }, { label: "Mathematics", icon: "chalk" }, { label: "Physics", icon: "orbit" }, { label: "History", icon: "book" }, { label: "Computer science", icon: "neuron" }].map(s => <span className={styles.subject} key={s.label} role="listitem"><img src={`${art}${s.icon}.svg`} width="80" height="80" alt="" />{s.label}</span>)}</div></section>

    <section id="whiteboard" className={styles.whiteboardSection} aria-labelledby="whiteboard-title">
      <Reveal className={styles.sectionIntro}><h2 id="whiteboard-title">Some things just<br />need a little drawing.</h2><p>A moving picture. A simple analogy. That one connection you were missing. Chalky brings ideas onto the board, one clear step at a time.</p></Reveal>
      <Reveal><WhiteboardDemo motionPaused={paused} /></Reveal>
    </section>

    <section className={styles.voiceSection} aria-labelledby="voice-title"><div className={styles.voiceInner}>
      <Reveal className={styles.voiceCopy}><h2 id="voice-title">Every good question<br />deserves a<br />conversation.</h2><p>Go off script. Ask “but why?” three times.<br />Interrupt with the question that just clicked.<br />There’s room for all of it here.</p></Reveal>
      <Reveal delay={0.15}><Conversation /></Reveal>
    </div></section>

    <section id="how-it-works" className={styles.howSection} aria-labelledby="how-title">
      <Reveal className={styles.howHeading}><h2 id="how-title">From “I don’t get it”<br />to “I’ve got this.”</h2><p>No perfect prompts. No big setup.<br />Just you, Chalky, and a place to start.</p></Reveal>
      <div className={styles.steps}>{[
        { n: "01", icon: "conversation", title: "Bring your question.", body: "The one from class. The one you’ve asked twice. The one that popped into your head at midnight." },
        { n: "02", icon: "book", title: "Find your way in.", body: "See it drawn out. Try an analogy. Ask for a slower explanation until the idea starts to feel familiar." },
        { n: "03", icon: "chalk", title: "Give it a go.", body: "Talk through the answer. Work out a problem. Put the idea in your own words and see what sticks." },
      ].map((s, i) => <Reveal key={s.n} delay={i * 0.1} className={styles.step}><div className={styles.stepArt}><img src={`${art}${s.icon}.svg`} width="170" height="170" alt="" /></div><h3>{s.title}</h3><p>{s.body}</p></Reveal>)}</div>
    </section>

    <section id="questions" className={styles.faqSection} aria-labelledby="faq-title"><Reveal className={styles.faqIntro}><h2 id="faq-title">Good<br />questions.</h2><img src={`${art}plant.svg`} width="130" height="130" alt="" /></Reveal><div className={styles.faqList}>{questions.map(q => <details key={q.q}><summary>{q.q}<span aria-hidden="true">+</span></summary><p>{q.a}</p></details>)}</div></section>

    <section className={styles.finalSection} aria-labelledby="final-title"><Reveal><img src={`${art}chalk.svg`} width="105" height="105" alt="" /><h2 id="final-title">Stay curious.<br />We’ll bring the chalk.</h2><StartLink /></Reveal></section>

    <footer className={styles.footer}><Brand footer /><button onClick={() => setMotionPaused(p => !p)} aria-pressed={paused} disabled={!!reduced}>{paused ? "Motion paused" : "Pause motion"}<span aria-hidden="true">{paused ? "▷" : "Ⅱ"}</span></button><a href="#hero-title">Back to top ↑</a></footer>
  </main></MotionConfig>;
}
